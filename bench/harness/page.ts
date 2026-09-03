// Bench page — the browser side of the full-reindex throughput bench
// (ticket nid_pt77674z2iel2w8rmdga3bvkb_e). Bundled by esbuild.mjs from the REAL
// production modules (LocalEmbedder → IframeRunner → transformers.js in a srcdoc
// iframe, SearchOrchestrator, IndexStore on the browser's real IndexedDB) and
// loaded into a real Chromium page by run.mjs, which drives it through
// `window.__seekerBench`. Only the Vault is faked (FakeVault: the same in-memory
// map the tier-2 scenario harness uses), so the measured path is the plugin's
// own.
//
// Obsidian runtime surface the bundled modules touch, provided here instead of
// by Obsidian: `activeWindow`/`activeDocument` (popout-window convention, see
// src/test-stubs/test-setup.mts) and `HTMLElement.prototype.addClass`
// (iframe-runner.ts hides its iframe with it). The `obsidian` module itself is
// aliased to src/test-stubs/obsidian.ts by esbuild.mjs.
import { LocalEmbedder, indexWarmupGrid } from '../../src/embedder';
import { IndexStore } from '../../src/index-store';
import { SearchOrchestrator } from '../../src/search';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { IndexCompleteEntry, LoadEntry, RequestedDevice, SeekSettings } from '../../src/types';
import type { SeekLogger } from '../../src/logger';
import { ACTIVE_MODEL_SPEC } from '../../src/model-registry';
import { getResolvedBackend, recordResolvedBackend, getBackendOverride, isMobilePlatform } from '../../src/platform';
import { overrideDesktopWebgpuSizing, warmupPassCount, type BatchSizing } from '../../src/batch-sizing';
import { pacingPolicyFor } from '../../src/pacing-policy';
import { overrideWindowFocus } from '../../src/pacer';
import type { ResolvedBackend } from '../../src/platform';
import { FakeVault } from '../../src/test-harness/fake-vault';
import { CacheWarmDrainer } from './drain-cache-warm';
import type { Forensics } from '../../src/forensics';
import type { App } from 'obsidian';

// ── Obsidian globals ────────────────────────────────────────────────────────
// Set before any bundled module runs (this file is the bundle entry, and esbuild
// hoists imports, so the assignments below execute after module evaluation but
// before any call — none of the imported modules touch these at import time).
declare global {
    interface Window { __seekerBench: BenchApi; }
    interface HTMLElement { addClass(cls: string): void; }
}
const w = window as unknown as Record<string, unknown>;
w.activeWindow = window;
w.activeDocument = document;
if (typeof HTMLElement.prototype.addClass !== 'function') {
    HTMLElement.prototype.addClass = function (this: HTMLElement, cls: string): void { this.classList.add(cls); };
}

// ── what run.mjs reads back ─────────────────────────────────────────────────
export interface CorpusFile { path: string; content: string; }

// The load entry plus what main.ts derives from it right after load
// (recordResolvedBackend → getResolvedBackend), so BENCH_PROBE output shows the
// same resolved-backend record the settings tab would.
export interface ProbeResult {
    load: LoadEntry;
    resolvedBackend: ResolvedBackend | null;
    // Whether the page was hidden during the run: pacer.ts takes a different
    // (yield-only) path when hidden, so a bench on a hidden page measures a
    // different thing. Reported so a surprising number can be explained.
    documentHidden: boolean;
    modelRepo: string;
    // The budget/max the indexer will flush with on the resolved device UNDER
    // THIS RUN'S PACING (lever 2: focused → base tier, unfocused / perf-mode →
    // the desktop-WebGPU tier), so a results.ndjson row is self-describing.
    batchSizing: BatchSizing;
    // BENCH_PACING as applied to this run — see BenchPacing.
    pacing: BenchPacing;
    // Forward passes a cold warmup of this platform's WebGPU grid runs (the
    // "grid passes" column of the sizing sweep).
    warmupPasses: number;
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

// Which pacing-policy tier the run measures (BENCH_PACING, lever 2 — see
// src/pacing-policy.ts). A headless page's hasFocus() answer is a browser-driver
// detail, so the bench pins the focus signal instead of trusting it:
//   focused    — window focused, Performance mode off: rIC idle gate + base 512/8
//                (the pre-lever-1 reference; should reproduce its numbers).
//   unfocused  — window unfocused: cheap yield + the desktop-WebGPU tier. The
//                headline row: what a user who switched away gets.
//   perf-mode  — window focused + Performance mode on: same tier as unfocused.
export type BenchPacing = 'focused' | 'unfocused' | 'perf-mode';

export interface BenchOptions {
    // `batchSizing` (BENCH_BATCH_SIZING) swaps the desktop-WebGPU sizing for the
    // sweep; null = the constant shipped in src/batch-sizing.ts.
    batchSizing: BatchSizing | null;
    pacing: BenchPacing;
}

export interface BenchApi {
    probe(device: RequestedDevice, opts: BenchOptions): Promise<ProbeResult>;
    run(device: RequestedDevice, files: CorpusFile[], opts: BenchOptions): Promise<RunResult>;
}

// ── wiring (mirrors src/test-harness/scenario.ts boot(), minus the fakes) ───
const logger: SeekLogger = { deviceId: 'bench', append: async () => {}, appendError: async () => {} } as unknown as SeekLogger;

// Captures the completion beat's counters; search.ts only ever calls beat().
class BeatCapture {
    paddedTokens: number | null = null;
    beat(type: string, detail?: Record<string, unknown>): void {
        if (type === 'index-complete' && typeof detail?.paddedTokens === 'number') this.paddedTokens = detail.paddedTokens;
    }
}

// The settings the orchestrator runs with: DEFAULT_SETTINGS plus the
// Performance-mode flag the pacing option implies.
function benchSettings(pacing: BenchPacing): SeekSettings {
    return { ...structuredClone(DEFAULT_SETTINGS), performanceMode: pacing === 'perf-mode' };
}

async function loadModel(device: RequestedDevice, { batchSizing, pacing }: BenchOptions): Promise<{ embedder: LocalEmbedder; probe: ProbeResult }> {
    // Before the embedder loads: the warmup grid + fingerprint are derived from
    // the sizing at load time.
    overrideDesktopWebgpuSizing(batchSizing);
    overrideWindowFocus(pacing !== 'unfocused');
    const embedder = new LocalEmbedder();
    // Same call main.ts makes (CDN-streamed spec; the LOCAL_MODEL dev override
    // is not a bench concern).
    const load = await embedder.load(device, ACTIVE_MODEL_SPEC.dtype, ACTIVE_MODEL_SPEC.repo, ACTIVE_MODEL_SPEC.revision);
    recordResolvedBackend({
        device: load.actualDevice,
        requested: getBackendOverride(),
        reason: load.resolvedReason,
        adapter: load.adapter
            ? { vendor: load.adapter.vendor, architecture: load.adapter.architecture, description: load.adapter.description }
            : null,
    });
    return {
        embedder,
        probe: {
            load, resolvedBackend: getResolvedBackend(), documentHidden: document.hidden, modelRepo: ACTIVE_MODEL_SPEC.repo,
            // Same inputs the orchestrator resolves per dispatch
            // (SearchOrchestrator.pacingDecision), from the bench's pinned signals.
            batchSizing: pacingPolicyFor({
                isMobile: isMobilePlatform(), device: load.actualDevice,
                performanceMode: pacing === 'perf-mode', focused: pacing !== 'unfocused', hidden: document.hidden,
            }).sizing,
            pacing,
            warmupPasses: warmupPassCount(indexWarmupGrid()),
        },
    };
}

async function probe(device: RequestedDevice, opts: BenchOptions): Promise<ProbeResult> {
    const { embedder, probe } = await loadModel(device, opts);
    await embedder.teardown();
    return probe;
}

async function run(device: RequestedDevice, files: CorpusFile[], opts: BenchOptions): Promise<RunResult> {
    const { embedder, probe } = await loadModel(device, opts);
    const vault = new FakeVault();
    for (const f of files) vault.write(f.path, f.content, 1);

    // Fresh DB per run (uniqueness in `scope`, see scenario.ts boot()); deleted
    // afterwards so the persistent profile never accumulates stale indexes.
    const store = new IndexStore();
    const scope = `bench-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await store.open(scope, 'seeker-bench');
    const app = { vault, metadataCache: { isUserIgnored: () => false } } as unknown as App;
    const beats = new BeatCapture();
    const orch = new SearchOrchestrator(app, store, embedder, logger, benchSettings(opts.pacing), beats as unknown as Forensics);
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

// Awaited (not fire-and-forget): run.mjs closes the browser context as soon as
// run() resolves, and an in-flight delete request dies with it, leaving a stale
// index in the persistent profile for every run.
// `blocked` is NOT a failure: it fires if the store's just-closed connection
// still has a transaction in flight. drain() above settles the known one
// (persistBm25); this stays as a backstop. The connection closes once that
// transaction ends and `success` follows, so we only log and keep waiting.
function deleteDb(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error(`deleteDatabase(${dbName}) failed`));
        req.onblocked = () => console.warn(`[bench] deleteDatabase(${dbName}) blocked by an in-flight transaction; waiting for it to close`);
    });
}

window.__seekerBench = { probe, run };
