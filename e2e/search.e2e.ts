import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CORPUS_DIR, ObsidianHarness, PLUGIN_ID } from "./obsidianHarness";

/**
 * Basic search flow in a REAL Obsidian: command opens the modal, empty-index
 * onboarding, full reindex of the corpus, curated queries rank within bound in
 * the rendered modal, Enter opens the top result.
 *
 * Serial by design: ONE Obsidian instance for the whole file; tests build on
 * earlier state (c indexes, d/e search the index).
 */

test.describe.configure({ mode: "serial" });

/**
 * Selectors/texts duplicated from `src/search-modal.ts` / `src/query-field.ts`.
 * WHY duplicated: importing them would pull `obsidian` (types-only under node)
 * into the spec. Skeleton placeholder rows also carry `.seeker-result`, hence
 * the `:not(.seeker-skeleton)`.
 */
const SEEKER_DOM = {
	modal: ".seeker-modal",
	edit: ".seeker-edit",
	noIndex: ".seeker-noindex",
	noIndexTitle: "Your vault isn’t indexed yet", // curly apostrophe (U+2019), as rendered
	resultRow: ".seeker-result:not(.seeker-skeleton)",
	resultTitle: ".seeker-result-title",
	loading: ".seeker-modal .is-loading",
} as const;

const SEARCH_COMMAND_ID = `${PLUGIN_ID}:search`;
/** Last `onProgress` message of a completed pass (`src/search.ts`). */
const REINDEX_DONE_PATTERN = /^Indexed (\d+) files · (\d+) chunks$/;
/** First run downloads the ~100 MB model before indexing. */
const REINDEX_TEST_TIMEOUT_MS = 10 * 60_000;
/** Search after typing awaits the (cached) model load + debounce. */
const RESULTS_TIMEOUT_MS = 60_000;
const TOP_TITLES_IN_MESSAGE = 5;
/** The query used for the Enter test: a keyword query whose expected note must rank first. */
const ENTER_TEST_QUERY_ID = "kw-zipalign";

// ── Removal-from-index tests (f/g/h) ────────────────────────────────────────
// These run AFTER the corpus is indexed (test c) and the model is loaded, and
// drive Seeker's REAL incremental path: a vault create/delete/modify fires the
// plugin's own vault-event handlers (which enqueue the change), then we drain
// the queue via the production flushDirty() — bypassing only its 5-min debounce,
// which is far too slow for a test. Unique nonsense tokens keep every assertion
// deterministic: a token present in exactly one (new) note is a guaranteed BM25
// hit, and once the note/text is gone the token has zero lexical presence.
const REMOVAL_NOTE_PATH = "e2e-removal-note.md";
const REMOVAL_TOKEN = "Zqxjvblorptunium";
const EDIT_NOTE_PATH = "e2e-edit-note.md";
const EDIT_TOKEN = "Wbrtklmnqxphase";
const OCR_IMAGE_PATH = "e2e-ocr-image.png";
/** Clean, real words rendered into the test image — none appear in the Android
 *  corpus, so a lexical hit can only come from the image's OCR text. Several
 *  lines on purpose: the OCR body must clear the chunker's 50-char minimum
 *  (`minChunkChars`) or the image yields ZERO indexable chunks. */
const OCR_IMAGE_LINES = [
	"photosynthesis quokka zeppelin",
	"marmalade telescope narwhal",
	"avocado harmonica lighthouse",
];
/** A distinctive word from the image, queried to prove the OCR text is indexed. */
const OCR_QUERY = "photosynthesis";
/** How long to wait for a vault event to reach the plugin's incremental queues. */
const EVENT_QUEUE_TIMEOUT_MS = 5_000;
/** Cold OCR streams tesseract core (~4.7 MB) + the eng pack (~11 MB) from a CDN
 *  before the first recognise, so this test needs the reindex-sized budget. */
const OCR_TEST_TIMEOUT_MS = 6 * 60_000;

interface CuratedQuery {
	id: string;
	kind: string;
	text: string;
	expectDocId: string;
	maxRank: number;
	rationale: string;
}

const CURATED_QUERIES: CuratedQuery[] = JSON.parse(
	fs.readFileSync(path.join(CORPUS_DIR, "..", "curated-queries.json"), "utf8"),
);
const CORPUS_FILE_COUNT = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".md")).length;

let harness: ObsidianHarness;
let page: Page;

test.beforeAll(async () => {
	harness = await ObsidianHarness.launch();
	page = harness.page;
});

test.afterAll(async () => {
	await harness?.close();
});

async function openModal(): Promise<void> {
	await harness.runCommand(SEARCH_COMMAND_ID);
	await expect(page.locator(SEEKER_DOM.modal)).toBeVisible();
}

/**
 * One Escape closes the modal ONLY while no suggestion menu is open: the query
 * field swallows the first Escape to dismiss its menu (`src/query-field.ts`),
 * which opens when the trailing word prefixes an operator key (`tag`, `path`,
 * …) or starts with `#`. Curated query texts must not end that way.
 */
async function closeModal(): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(page.locator(SEEKER_DOM.modal)).toBeHidden();
}

function resultTitles(): Promise<string[]> {
	return page.locator(`${SEEKER_DOM.resultRow} ${SEEKER_DOM.resultTitle}`).allTextContents();
}

/** Waits until no re-search is in flight AND at least one real row is rendered. */
async function waitForResults(): Promise<string[]> {
	await expect
		.poll(
			async () =>
				(await page.locator(SEEKER_DOM.loading).count()) === 0 && (await resultTitles()).length > 0,
			{ timeout: RESULTS_TIMEOUT_MS },
		)
		.toBe(true);
	return resultTitles();
}

test("a. search command opens the modal with the query field focused", async () => {
	await openModal();
	await expect
		.poll(() => page.evaluate(() => document.activeElement?.classList.contains("seeker-edit") ?? false))
		.toBe(true);
});

test("b. unindexed vault shows the onboarding panel without typing", async () => {
	// No typing: a search would first await the model load (slow on a cold cache).
	const noIndex = page.locator(SEEKER_DOM.noIndex);
	await expect(noIndex).toBeVisible();
	await expect(noIndex).toContainText(SEEKER_DOM.noIndexTitle);
	await closeModal();
});

test("c. full reindex indexes the whole corpus", async () => {
	test.setTimeout(REINDEX_TEST_TIMEOUT_MS);
	const outcome = await page.evaluate(async (pluginId) => {
		const plugin = (window as unknown as { app: any }).app.plugins.plugins[pluginId];
		const msgs: string[] = [];
		const ran: boolean = await plugin.runFullReindex({
			skipConfirm: true,
			onProgress: (m: string) => msgs.push(m),
		});
		// `orchestrator` is TS-private on the plugin (compile-time only).
		const chunks: number | null = await plugin.orchestrator.indexedChunkCount();
		return { ran, last: msgs.at(-1) ?? null, chunks };
	}, PLUGIN_ID);
	// `ran` is true whenever a pass RAN (even a failed one); the last progress
	// message is the reliable completion signal.
	expect(outcome.ran).toBe(true);
	const match = outcome.last?.match(REINDEX_DONE_PATTERN) ?? null;
	expect(match, `last progress message: ${outcome.last}`).not.toBeNull();
	expect(Number(match![1])).toBe(CORPUS_FILE_COUNT);
	expect(outcome.chunks).toBeGreaterThan(0);
});

for (const q of CURATED_QUERIES) {
	test(`d. ${q.id}: "${q.text}" ranks ${q.expectDocId} within ${q.maxRank}`, async () => {
		await openModal();
		try {
			await page.keyboard.type(q.text);
			const titles = await waitForResults();
			const rank = titles.indexOf(q.expectDocId);
			const msg =
				`query=[${q.text}] expectDocId=[${q.expectDocId}] ` +
				`top${TOP_TITLES_IN_MESSAGE}=[${titles.slice(0, TOP_TITLES_IN_MESSAGE).join(", ")}]`;
			expect(rank, msg).toBeGreaterThanOrEqual(0);
			expect(rank, msg).toBeLessThan(q.maxRank);
		} finally {
			await closeModal();
		}
	});
}

test("e. Enter opens the top result", async () => {
	const q = CURATED_QUERIES.find((entry) => entry.id === ENTER_TEST_QUERY_ID);
	if (q === undefined) {
		throw new Error(`curated query missing: id=[${ENTER_TEST_QUERY_ID}]`);
	}
	await openModal();
	await page.keyboard.type(q.text);
	await waitForResults();
	await page.keyboard.press("Enter");
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as { app: any }).app.workspace.getActiveFile()?.path ?? null),
		)
		.toBe(`${q.expectDocId}.md`);
	await closeModal();
});

// ── Removal helpers ─────────────────────────────────────────────────────────
// All search here goes straight through the orchestrator (headless, no modal) so
// a removal assertion reads the index directly, not the rendered UI. bm25 > 0 is
// the deterministic "this note lexically contains the token" signal: a query
// token with no postings scores 0 on every note, so "gone from the index" is a
// hard fact, not a ranking-noise judgement.
interface SearchHit {
	note_path: string;
	bm25: number;
}

async function searchHits(query: string, topK = 30): Promise<SearchHit[]> {
	return page.evaluate(
		async ({ pluginId, query, topK }) => {
			const plugin = (window as unknown as { app: any }).app.plugins.plugins[pluginId];
			// The model is already loaded by test c; this is a no-op fast path that
			// also guards against running headless before a cold load completes.
			await plugin.ensureModelLoaded();
			const { results } = await plugin.orchestrator.search(query, topK);
			return results.map((r: { note_path: string; ranking_signals?: { bm25?: number } }) => ({
				note_path: r.note_path,
				bm25: r.ranking_signals?.bm25 ?? 0,
			}));
		},
		{ pluginId: PLUGIN_ID, query, topK },
	);
}

/** True when the query is a lexical hit on `notePath` (token present in its index). */
function isLexicalHit(hits: SearchHit[], notePath: string): boolean {
	return hits.some((h) => h.note_path === notePath && h.bm25 > 0);
}

/**
 * Create a note through Obsidian, prove the plugin's OWN `create` handler
 * enqueued it (the removal-event wiring the ticket calls for, in reverse), then
 * drain the queue via the production flush. Returns whether the event fired.
 */
async function createAndIndexNote(notePath: string, content: string): Promise<boolean> {
	return page.evaluate(
		async ({ pluginId, notePath, content, timeoutMs }) => {
			const app = (window as unknown as { app: any }).app;
			const plugin = app.plugins.plugins[pluginId];
			await app.vault.create(notePath, content);
			const deadline = Date.now() + timeoutMs;
			while (!plugin.dirtyQueue.has(notePath) && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}
			const queuedByCreateEvent = plugin.dirtyQueue.has(notePath);
			await plugin.flushDirty();
			return queuedByCreateEvent;
		},
		{ pluginId: PLUGIN_ID, notePath, content, timeoutMs: EVENT_QUEUE_TIMEOUT_MS },
	);
}

/**
 * Delete a file through Obsidian, prove the plugin's `delete` handler enqueued
 * the removal, then drain. Returns whether the delete event fired — the explicit
 * "we get an event for removal" check the ticket asks for.
 */
async function deleteAndIndex(notePath: string): Promise<boolean> {
	return page.evaluate(
		async ({ pluginId, notePath, timeoutMs }) => {
			const app = (window as unknown as { app: any }).app;
			const plugin = app.plugins.plugins[pluginId];
			const file = app.vault.getAbstractFileByPath(notePath);
			if (!file) throw new Error(`e2e: file to delete not found: ${notePath}`);
			await app.vault.delete(file);
			const deadline = Date.now() + timeoutMs;
			while (!plugin.deletedQueue.has(notePath) && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}
			const queuedByDeleteEvent = plugin.deletedQueue.has(notePath);
			await plugin.flushDirty();
			return queuedByDeleteEvent;
		},
		{ pluginId: PLUGIN_ID, notePath, timeoutMs: EVENT_QUEUE_TIMEOUT_MS },
	);
}

/**
 * Edit a note's text and re-index it. Seeker indexes edits when you LEAVE a note
 * (active-leaf-change → enqueueIfDirty), not on a raw `modify`, so we mirror that
 * exact path, then drain.
 */
async function modifyAndIndex(notePath: string, content: string): Promise<void> {
	await page.evaluate(
		async ({ pluginId, notePath, content }) => {
			const app = (window as unknown as { app: any }).app;
			const plugin = app.plugins.plugins[pluginId];
			const file = app.vault.getAbstractFileByPath(notePath);
			if (!file) throw new Error(`e2e: file to modify not found: ${notePath}`);
			await app.vault.modify(file, content);
			await plugin.enqueueIfDirty(file);
			await plugin.flushDirty();
		},
		{ pluginId: PLUGIN_ID, notePath, content },
	);
}

test("f. deleting a note removes it from the index", async () => {
	const queuedOnCreate = await createAndIndexNote(
		REMOVAL_NOTE_PATH,
		`# ${REMOVAL_TOKEN} research log\n\n` +
			`${REMOVAL_TOKEN} is a fictional element documented here for the Seeker ` +
			`end-to-end removal test. It stays searchable by its unique name until the note is deleted.\n`,
	);
	expect(queuedOnCreate, "the plugin's create handler should enqueue the new note").toBe(true);

	// Precondition: the unique token is searchable (a real lexical hit on the note).
	await expect
		.poll(async () => isLexicalHit(await searchHits(REMOVAL_TOKEN), REMOVAL_NOTE_PATH), {
			timeout: RESULTS_TIMEOUT_MS,
			message: `expected ${REMOVAL_NOTE_PATH} to be searchable by "${REMOVAL_TOKEN}" after indexing`,
		})
		.toBe(true);

	const queuedOnDelete = await deleteAndIndex(REMOVAL_NOTE_PATH);
	expect(queuedOnDelete, "the plugin's delete handler should enqueue the removal").toBe(true);

	// The note (and its chunk) must be gone entirely — no stale hit of any kind.
	await expect
		.poll(async () => (await searchHits(REMOVAL_TOKEN)).some((h) => h.note_path === REMOVAL_NOTE_PATH), {
			timeout: RESULTS_TIMEOUT_MS,
			message: `expected ${REMOVAL_NOTE_PATH} to be absent from results after deletion`,
		})
		.toBe(false);
});

test("g. removing text from a note clears it from the index (no stale data)", async () => {
	await createAndIndexNote(
		EDIT_NOTE_PATH,
		`# Seeker edit removal note\n\n` +
			`This note mentions ${EDIT_TOKEN}, a unique marker token used to prove that ` +
			`stale chunks are cleared when the text is removed.\n`,
	);

	await expect
		.poll(async () => isLexicalHit(await searchHits(EDIT_TOKEN), EDIT_NOTE_PATH), {
			timeout: RESULTS_TIMEOUT_MS,
			message: `expected ${EDIT_NOTE_PATH} to be searchable by "${EDIT_TOKEN}" after indexing`,
		})
		.toBe(true);

	// Remove ONLY the marker; the note itself lives on. Re-index must drop the
	// stale chunk so the token has zero lexical presence anywhere in the vault.
	await modifyAndIndex(
		EDIT_NOTE_PATH,
		`# Seeker edit removal note\n\n` +
			`The unique marker has been removed; this note now holds only generic filler ` +
			`text about nothing in particular.\n`,
	);

	await expect
		.poll(async () => (await searchHits(EDIT_TOKEN)).every((h) => h.bm25 === 0), {
			timeout: RESULTS_TIMEOUT_MS,
			message: `expected no lexical hits for "${EDIT_TOKEN}" after the marker was edited out`,
		})
		.toBe(true);

	await deleteAndIndex(EDIT_NOTE_PATH); // cleanup
});

test("h. deleting an OCR'd image removes it from the index", async () => {
	test.setTimeout(OCR_TEST_TIMEOUT_MS);

	// Enable image OCR (default-off) and wire the desktop engine. The harness
	// boots on DEFAULT settings, so this is the one test that opts in.
	await page.evaluate((pluginId) => {
		const plugin = (window as unknown as { app: any }).app.plugins.plugins[pluginId];
		plugin.settings.indexImages = true;
		plugin.refreshOcrEngine();
	}, PLUGIN_ID);

	// Render known text into a PNG in-page (no committed binary fixture, no
	// licensing question) and index it through the real create → OCR → embed path.
	const queuedOnCreate = await page.evaluate(
		async ({ pluginId, imagePath, lines, timeoutMs }) => {
			const app = (window as unknown as { app: any }).app;
			const plugin = app.plugins.plugins[pluginId];
			// Size the canvas to the measured text so nothing clips off the edge
			// (a clipped word OCRs into a truncated token that misses the query).
			const FONT = "56px sans-serif";
			const PAD = 60;
			const LINE_H = 84;
			const measure = document.createElement("canvas").getContext("2d")!;
			measure.font = FONT;
			const textWidth = Math.max(...lines.map((l) => measure.measureText(l).width));
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(textWidth) + PAD * 2;
			canvas.height = LINE_H * lines.length + PAD * 2;
			const ctx = canvas.getContext("2d")!; // sizing above reset any prior state
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.fillStyle = "#000000";
			ctx.font = FONT;
			ctx.textBaseline = "top";
			lines.forEach((l, i) => ctx.fillText(l, PAD, PAD + i * LINE_H));
			const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
			const bytes = await blob.arrayBuffer();
			await app.vault.createBinary(imagePath, bytes);
			const deadline = Date.now() + timeoutMs;
			while (!plugin.dirtyQueue.has(imagePath) && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50));
			}
			const queued = plugin.dirtyQueue.has(imagePath);
			// Drains through reindexDelta → ocrPrepass (streams tesseract on first
			// use) → embed; awaited, so OCR + indexing are complete on return.
			await plugin.flushDirty();
			return queued;
		},
		{ pluginId: PLUGIN_ID, imagePath: OCR_IMAGE_PATH, lines: OCR_IMAGE_LINES, timeoutMs: EVENT_QUEUE_TIMEOUT_MS },
	);
	expect(queuedOnCreate, "the plugin's create handler should enqueue the new image").toBe(true);

	// Precondition: the OCR'd word is a lexical hit on the image document.
	await expect
		.poll(async () => isLexicalHit(await searchHits(OCR_QUERY), OCR_IMAGE_PATH), {
			timeout: RESULTS_TIMEOUT_MS,
			message: `expected ${OCR_IMAGE_PATH} to be searchable by its OCR text "${OCR_QUERY}" after indexing`,
		})
		.toBe(true);

	const queuedOnDelete = await deleteAndIndex(OCR_IMAGE_PATH);
	expect(queuedOnDelete, "the plugin's delete handler should enqueue the image removal").toBe(true);

	// The image document must be gone — no stale OCR hit.
	await expect
		.poll(async () => (await searchHits(OCR_QUERY)).some((h) => h.note_path === OCR_IMAGE_PATH), {
			timeout: RESULTS_TIMEOUT_MS,
			message: `expected ${OCR_IMAGE_PATH} to be absent from results after deletion`,
		})
		.toBe(false);
});
