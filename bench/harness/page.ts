// Bench page — the browser side of the full-reindex throughput bench
// (ticket nid_pt77674z2iel2w8rmdga3bvkb_e). Bundled by esbuild.mjs from the REAL
// production modules (LocalEmbedder → IframeRunner → transformers.js in a srcdoc
// iframe, SearchOrchestrator, IndexStore on the browser's real IndexedDB) and
// loaded into a real Chromium page by run.mjs, which drives it through
// `window.__seekerBench`. Only the Vault is faked (FakeVault: the same in-memory
// map the tier-2 scenario harness uses), so the measured path is the plugin's
// own. The shared browser-page scaffolding (Obsidian shims, model loader,
// fresh-DB delete) lives in ./page-common.ts, alongside the e2e retrieval page.
import { IndexStore } from '../../src/index-store';
import { SearchOrchestrator } from '../../src/search';
import type { IndexCompleteEntry, RequestedDevice } from '../../src/types';
import { FakeVault } from '../../src/test-harness/fake-vault';
import { CacheWarmDrainer } from './drain-cache-warm';
import type { Forensics } from '../../src/forensics';
import type { App } from 'obsidian';
import {
    type CorpusFile, type ProbeResult, logger, BeatCapture, harnessSettings, loadModel, deleteDb,
} from './page-common';

declare global {
    interface Window { __seekerBench: BenchApi; }
}

export interface RunResult extends ProbeResult {
    index: IndexCompleteEntry;
    // Headline number: wall-clock around SearchOrchestrator.reindexAll() only
    // (model load + warmup are in `load`, excluded on purpose).
    wallClockMs: number;
    // From the 'index-complete' forensics beat — the only place search.ts
    // surfaces the padded-token counter (it is not on IndexCompleteEntry).
    paddedTokens: number | null;
    dbName: string;
}

export interface BenchApi {
    probe(device: RequestedDevice): Promise<ProbeResult>;
    run(device: RequestedDevice, files: CorpusFile[]): Promise<RunResult>;
}

async function probe(device: RequestedDevice): Promise<ProbeResult> {
    const { embedder, probe } = await loadModel(device);
    await embedder.teardown();
    return probe;
}

async function run(device: RequestedDevice, files: CorpusFile[]): Promise<RunResult> {
    const { embedder, probe } = await loadModel(device);
    const vault = new FakeVault();
    for (const f of files) vault.write(f.path, f.content, 1);

    // Fresh DB per run (uniqueness in `scope`, see scenario.ts boot()); deleted
    // afterwards so the persistent profile never accumulates stale indexes.
    const store = new IndexStore();
    const scope = `bench-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await store.open(scope, 'seeker-bench');
    const app = { vault, metadataCache: { isUserIgnored: () => false } } as unknown as App;
    const beats = new BeatCapture();
    const orch = new SearchOrchestrator(app, store, embedder, logger, harnessSettings(), beats as unknown as Forensics);
    // Installed before reindexAll() so the warm's persistBm25 call is captured.
    const drainer = new CacheWarmDrainer(orch);
    try {
        const t0 = performance.now();
        const index = await orch.reindexAll();
        const wallClockMs = parseFloat((performance.now() - t0).toFixed(2));
        // reindexAll() leaves a fire-and-forget warmCaches() + persistBm25() in
        // flight (see drain-cache-warm.ts); settle them before the finally closes
        // the store, or persistBm25 logs a benign "IndexStore not opened" warning.
        await drainer.drain();
        return { ...probe, index, wallClockMs, paddedTokens: beats.paddedTokens, dbName: store.dbName };
    } finally {
        orch.dispose();
        await embedder.teardown();
        const dbName = store.dbName;
        store.close();
        await deleteDb(dbName);
    }
}

window.__seekerBench = { probe, run };
