// Retrieval e2e page — the browser side of the retrieval-quality suite
// (plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e, ticket nid_tthbuk08rra4lyenl50t6de1c_e).
// Bundled by bench/harness/esbuild.mjs (entry 'e2e/harness/page.ts') from the
// REAL production modules and loaded into a real Chromium page by
// e2e/harness/run.mjs, which drives it through `window.__seekerE2E`. Shares its
// scaffolding (Obsidian shims, model loader, fresh-DB delete) with the indexing
// bench page via ../../bench/harness/page-common. Only the Vault is faked, so the
// indexed + ranked path is the plugin's own.
import { IndexStore } from '../../src/index-store';
import { SearchOrchestrator } from '../../src/search';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { IndexCompleteEntry, LoadEntry, RequestedDevice, ScoredChunk } from '../../src/types';
import { FakeVault } from '../../src/test-harness/fake-vault';
import { CacheWarmDrainer } from '../../bench/harness/drain-cache-warm';
import type { Forensics } from '../../src/forensics';
import type { App } from 'obsidian';
import {
    type CorpusFile, logger, BeatCapture, harnessSettings, loadModel, deleteDb,
} from '../../bench/harness/page-common';

declare global {
    interface Window { __seekerE2E: E2EApi; }
}

export interface QueryInput { id: string; text: string; }

// One ranked note in a query's result list. `noteId` is the corpus doc id
// (basename of note_path without .md) — the id the metrics/qrels key on.
export interface RetrievedNote {
    noteId: string;
    title: string;
    score: number;
    signals: ScoredChunk['ranking_signals'];
}

// alpha (denseWeight) → queryId → ranked notes. Keys are the JSON-stringified
// alpha values (object keys are always strings).
export type PerWeightResults = Record<string, Record<string, RetrievedNote[]>>;

export interface RetrievalResult {
    index: IndexCompleteEntry;
    load: LoadEntry;
    perWeight: PerWeightResults;
    timings: {
        indexMs: number;
        // Latency of the very FIRST search() call (first alpha, first query): it
        // alone pays the one-off frame + BM25 cache build; every later query is warm.
        firstQueryMs: number | null;
        queriesMs: Record<string, number>; // alpha → wall-clock over all queries in that pass
    };
}

export interface E2EApi {
    // The shipped hybrid alpha (DEFAULT_SETTINGS.denseWeight); the runner reads it
    // to build the default channel and echoes it so the test knows which
    // perWeight key to gate on.
    defaultDenseWeight: number;
    evalRetrieval(
        device: RequestedDevice,
        files: CorpusFile[],
        queries: QueryInput[],
        topK: number,
        denseWeights: number[],
    ): Promise<RetrievalResult>;
}

const round2 = (ms: number): number => parseFloat(ms.toFixed(2));

// Doc id = basename of the vault path without .md (search() dedupes per note, so
// note_path is unique per result — see the plan's "Key facts").
const noteIdOf = (notePath: string): string => (notePath.split('/').pop() ?? notePath).replace(/\.md$/, '');

async function evalRetrieval(
    device: RequestedDevice,
    files: CorpusFile[],
    queries: QueryInput[],
    topK: number,
    denseWeights: number[],
): Promise<RetrievalResult> {
    const { embedder, probe } = await loadModel(device);
    const vault = new FakeVault();
    for (const f of files) vault.write(f.path, f.content, 1);

    // Fresh DB per run; deleted afterwards so the persistent profile never keeps a
    // stale index (same discipline as the bench page).
    const store = new IndexStore();
    const scope = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await store.open(scope, 'seeker-e2e');
    const app = { vault, metadataCache: { isUserIgnored: () => false } } as unknown as App;
    const beats = new BeatCapture();

    // ONE orchestrator built with a settings object we keep by reference. search()
    // reads this.settings.denseWeight per call (constructor stores it by
    // reference, search.ts), so a per-channel pass = mutate settings.denseWeight
    // between passes. The harness is single-threaded, so the overlapping-caller
    // hazard documented above search() cannot occur here. WHY NOT one orchestrator
    // per alpha: each would rebuild the frame + BM25 caches from IndexedDB.
    const settings = harnessSettings();
    const orch = new SearchOrchestrator(app, store, embedder, logger, settings, beats as unknown as Forensics);
    const drainer = new CacheWarmDrainer(orch);
    try {
        const t0 = performance.now();
        const index = await orch.reindexAll();
        const indexMs = round2(performance.now() - t0);
        // Settle the fire-and-forget warmCaches()/persistBm25() before querying so
        // the BM25 cache the first query would otherwise build is already warm.
        await drainer.drain();

        const defaultDenseWeight = settings.denseWeight;
        const perWeight: PerWeightResults = {};
        const queriesMs: Record<string, number> = {};
        let firstQueryMs: number | null = null;

        for (const alpha of denseWeights) {
            settings.denseWeight = alpha;
            const perQuery: Record<string, RetrievedNote[]> = {};
            const tAlpha = performance.now();
            for (const q of queries) {
                const tq = performance.now();
                const { results } = await orch.search(q.text, topK);
                if (firstQueryMs === null) firstQueryMs = round2(performance.now() - tq);
                // search() already returns <= topK UNIQUE notes (S3 dedupByPath);
                // do not over-fetch or re-dedupe.
                perQuery[q.id] = results.map((r) => ({
                    noteId: noteIdOf(r.note_path),
                    title: r.title,
                    score: r.score,
                    signals: r.ranking_signals,
                }));
            }
            queriesMs[String(alpha)] = round2(performance.now() - tAlpha);
            perWeight[String(alpha)] = perQuery;
        }
        // Restore the default so nothing downstream sees a mutated settings object.
        settings.denseWeight = defaultDenseWeight;

        return { index, load: probe.load, perWeight, timings: { indexMs, firstQueryMs, queriesMs } };
    } finally {
        orch.dispose();
        await embedder.teardown();
        const dbName = store.dbName;
        store.close();
        await deleteDb(dbName);
    }
}

window.__seekerE2E = { defaultDenseWeight: DEFAULT_SETTINGS.denseWeight, evalRetrieval };
