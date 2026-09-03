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
});
