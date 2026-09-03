// Shared browser-page scaffolding for the Chromium harnesses: the Obsidian
// runtime shims, the model loader, the fresh-DB delete, and the tiny logger/beat
// stubs. Imported by BOTH page entries — bench/harness/page.ts (the indexing
// bench, window.__seekerBench) and e2e/harness/page.ts (the retrieval e2e suite,
// window.__seekerE2E) — so the two pages boot the REAL production stack
// (LocalEmbedder → iframe transformers.js, SearchOrchestrator, IndexStore on real
// IndexedDB) identically and share ONE model cache. Extracted from the bench page
// (ticket nid_tthbuk08rra4lyenl50t6de1c_e); only the Vault is faked.
import { LocalEmbedder } from '../../src/embedder';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { LoadEntry, RequestedDevice, SeekerSettings } from '../../src/types';
import type { SeekerLogger } from '../../src/logger';
import { ACTIVE_MODEL_SPEC } from '../../src/model-registry';
import { getResolvedBackend, recordResolvedBackend, getBackendOverride } from '../../src/platform';
import { BATCH_SIZING, type BatchSizing } from '../../src/batch-sizing';
import type { ResolvedBackend } from '../../src/platform';

// ── Obsidian globals ────────────────────────────────────────────────────────
// Obsidian runtime surface the bundled modules touch, provided here instead of
// by Obsidian: `activeWindow`/`activeDocument` (popout-window convention, see
// src/test-stubs/test-setup.mts) and `HTMLElement.prototype.addClass`
// (iframe-runner.ts hides its iframe with it). The `obsidian` module itself is
// aliased to src/test-stubs/obsidian.ts by esbuild.mjs.
//
// Set before any bundled module runs: a page entry imports this module first, and
// esbuild hoists imports, so these assignments execute after module evaluation
// but before any call — none of the imported modules touch these at import time.
declare global {
    interface HTMLElement { addClass(cls: string): void; }
}
const w = window as unknown as Record<string, unknown>;
w.activeWindow = window;
w.activeDocument = document;
if (typeof HTMLElement.prototype.addClass !== 'function') {
    HTMLElement.prototype.addClass = function (this: HTMLElement, cls: string): void { this.classList.add(cls); };
}

// ── shared types ────────────────────────────────────────────────────────────
export interface CorpusFile { path: string; content: string; }

// The load entry plus what main.ts derives from it right after load
// (recordResolvedBackend → getResolvedBackend), so probe output shows the same
// resolved-backend record the settings tab would.
export interface ProbeResult {
    load: LoadEntry;
    resolvedBackend: ResolvedBackend | null;
    // Whether the page was hidden during the run: pacer.ts takes a different
    // (yield-only) path when hidden, so a run on a hidden page measures a
    // different thing. Reported so a surprising number can be explained.
    documentHidden: boolean;
    modelRepo: string;
    // The budget/max the indexer flushes with (BATCH_SIZING, one value on every
    // device), so a result row is self-describing.
    batchSizing: BatchSizing;
}

// ── wiring (mirrors src/test-harness/scenario.ts boot(), minus the fakes) ───
export const logger: SeekerLogger = { deviceId: 'harness', append: async () => {}, appendError: async () => {} } as unknown as SeekerLogger;

// Captures the completion beat's counters; search.ts only ever calls beat().
export class BeatCapture {
    paddedTokens: number | null = null;
    beat(type: string, detail?: Record<string, unknown>): void {
        if (type === 'index-complete' && typeof detail?.paddedTokens === 'number') this.paddedTokens = detail.paddedTokens;
    }
}

// A fresh clone every call so a caller that mutates it (the e2e per-channel
// denseWeight passes) never touches the shared DEFAULT_SETTINGS object.
export function harnessSettings(): SeekerSettings {
    return structuredClone(DEFAULT_SETTINGS);
}

export async function loadModel(device: RequestedDevice): Promise<{ embedder: LocalEmbedder; probe: ProbeResult }> {
    const embedder = new LocalEmbedder();
    // Same call main.ts makes, for the shipped default spec.
    const load = await embedder.load(ACTIVE_MODEL_SPEC, device);
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
            batchSizing: BATCH_SIZING,
        },
    };
}

// Awaited (not fire-and-forget): the runner closes the browser context as soon as
// the page call resolves, and an in-flight delete request dies with it, leaving a
// stale index in the persistent profile for every run.
// `blocked` is NOT a failure: it fires if the store's just-closed connection
// still has a transaction in flight. Callers drain the known one (persistBm25)
// first; this stays as a backstop. The connection closes once that transaction
// ends and `success` follows, so we only log and keep waiting.
export function deleteDb(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error(`deleteDatabase(${dbName}) failed`));
        req.onblocked = () => console.warn(`[harness] deleteDatabase(${dbName}) blocked by an in-flight transaction; waiting for it to close`);
    });
}
