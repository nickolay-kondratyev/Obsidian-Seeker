// Tier-2 scenario harness — drives the REAL SearchOrchestrator + REAL IndexStore
// (on fake-indexeddb) against fakes for the two things that aren't fakeable as
// data: the embedder (deterministic math instead of a 250 MB WASM heap) and the
// Vault (an in-memory path→{content,mtime} map instead of Obsidian's file layer).
//
// Why this exists: the unit suite pins each *decision* in isolation
// (classifyFileDelta, shouldStampLiveIdentity, …) with hand-built inputs. The
// bugs that have actually cost time were emergent ORDERING across
// computeDelta → reindexDelta → applyDelta → stamp → drain — invisible to any
// single-decision test. This harness composes the real pipeline under a scripted
// event stream so those convergence/lifecycle bugs become assertable.
//
// The dividing line (see [[Seek Testing Strategy]]): we fake the *inputs* Obsidian
// provides (file events, mtimes, vectors) — never the *behavior* it exhibits
// (WKWebView IDB cost, jetsam, iCloud races). fake-indexeddb is W3C-faithful, not
// WKWebView; the embedder is deterministic, not real WASM. The harness is honest
// about that boundary: logic under faked inputs, never platform behavior.
//
// Construction is inert under Node: BinaryScorerWorker's ctor early-returns when
// __BINARY_WORKER_SRC__ is empty (vitest), and IndexCoordinator's ctor is a field
// assignment. So the real orchestrator constructs with no source seam needed.
import 'fake-indexeddb/auto';            // installs a W3C-faithful indexedDB global
import { IndexStore } from '../index-store';
import { ACTIVE_MODEL_SPEC } from '../model-registry';
import { SearchOrchestrator } from '../search';
import { DEFAULT_SETTINGS, type SeekerSettings, type LogEntry } from '../types';
import type { App } from 'obsidian';
import type { LocalEmbedder } from '../embedder';
import type { OcrEngine, OcrResult } from '../ocr-cache';
import { FakeVault } from './fake-vault';

// ── fake Vault: lives in fake-vault.ts (shared with bench/harness/page.ts, which
// must not import this module's fake-indexeddb side effect). Re-exported so
// existing scenario tests keep importing it from here.
export { FakeVault };

// ── fake embedder: deterministic + content-derived ──────────────────────────
// Byte-stable (re-embedding identical text yields the identical vector, so the
// content-hash gate can be exercised) AND shared tokens raise cosine (so a
// scenario can assert search RESULTS, not just index state). 384-d to match the
// store's default embeddingDim.
const DIM = 384;
export function hashVec(text: string): Float32Array {
    const v = new Float32Array(DIM);
    for (const tok of text.toLowerCase().split(/\W+/)) {
        if (!tok) continue;
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
        v[(h >>> 0) % DIM] += 1;
    }
    // L2-normalize, matching the real model's CLS+normalize contract (cosine = dot).
    let norm = 0;
    for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm;
    return v;
}

// The fake embedder plus the text-capture the prefix scenarios read: `embedCalls`
// is every query embed() text (in order), `embedBatchCalls` every indexed doc
// embedBatch() text (flattened, in order). So a scenario can assert the ACTUAL
// bytes handed to the model — that the queryPrefix leads the query and the
// docPrefix leads every indexed chunk — not just the resulting vectors.
export interface RecordingEmbedder extends LocalEmbedder {
    embedCalls: string[];
    embedBatchCalls: string[];
}

export function fakeEmbedder(): RecordingEmbedder {
    const embedCalls: string[] = [];
    const embedBatchCalls: string[] = [];
    const e = {
        loaded: true,
        device: 'wasm',
        dtype: 'q4',
        modelId: ACTIVE_MODEL_SPEC.key, // informational only: meta stamps read activeModelSpec(settings).key
        // Match the REAL return shapes: embedBatch → { vectors, iframeLatencyMs },
        // embed → { vector, iframeLatencyMs }. Vectors aligned to inputs.
        embedBatch: async (texts: string[]) => { embedBatchCalls.push(...texts); return { vectors: texts.map(hashVec), iframeLatencyMs: 0 }; },
        embed: async (text: string) => { embedCalls.push(text); return { vector: hashVec(text), iframeLatencyMs: 0 }; },
        tokenCounts: async (texts: string[]) => texts.map(t => t.split(/\s+/).filter(Boolean).length),
        ensureTokenizer: async () => {},
        recycle: async () => {},
        teardown: async () => {},
        embedCalls,
        embedBatchCalls,
    };
    return e as unknown as RecordingEmbedder;
}

// ── fake OCR engine: bytes ARE the text ──────────────────────────────────────
// The double decodes the image bytes as UTF-8 and returns them as the OCR text,
// so a test writes `writeImage(path, encode('shot text'), t)` and gets 'shot
// text' back deterministically — and different text ⇒ different bytes ⇒
// different sha256, exactly like real images. Two conventions keep the failure
// cases readable: empty bytes → a text-free record; text starting `ERR:` → a
// deterministic `error` record (§5).
export function encodeImage(text: string): Uint8Array { return new TextEncoder().encode(text); }

export function fakeOcrEngine(): OcrEngine {
    return {
        engine: 'fake', version: '0', langs: ['eng'],
        async ocr(bytes: ArrayBuffer): Promise<OcrResult> {
            const text = new TextDecoder().decode(bytes);
            const pre = { scale: 1, maxEdge: 2000 };
            if (text.startsWith('ERR:')) return { text: '', conf: 0, w: 100, hpx: 100, ms: 1, error: text.slice(4), pre };
            return { text, conf: text === '' ? 0 : 90, w: 100, hpx: 100, ms: 1, error: null, pre };
        },
    };
}

// ── the scenario driver ─────────────────────────────────────────────────────
// Each helper mutates the vault, then runs the SAME orchestrator entrypoint the
// real Obsidian event handler runs (pinned against search.ts / main.ts):
//   • create/edit/touch/del → computeDelta() + reindexDelta() — the path
//     reconcileOnLoad / flushDirty / runCatchUp drive (main.ts).
//   • coldStart → reindexAll() — the empty-store full build (stamps identity).
export class Scenario {
    vault = new FakeVault();
    store = new IndexStore(() => ACTIVE_MODEL_SPEC.dim);
    embedder = fakeEmbedder();
    orch!: SearchOrchestrator;
    // Every entry the orchestrator logged (delta-apply, index-complete, …), so a
    // scenario can assert the SHAPE of a pass (e.g. "zero adds, zero removes"),
    // not just its side effects.
    logEntries: LogEntry[] = [];
    // Reverse-link map metadataCache.resolvedLinks exposes; the OCR pre-pass reads
    // it to ORDER its queue (image referenced by a note first). Mutable by a test.
    resolvedLinks: Record<string, Record<string, number>> = {};

    // `settings` overrides DEFAULT_SETTINGS for this scenario (e.g. a toggle OFF).
    // `indexDir` opts the orchestrator into an index dir (non-null) so the OCR
    // cache is live; scenarios that don't pass it keep the historical
    // indexDir=null / sidecarOn=false behaviour. The OCR cache is written whether
    // or not the sidecar is on, so image scenarios pass indexDir with
    // sidecarEnabled:false to exercise the cache without any sidecar writes.
    async boot(settings: Partial<SeekerSettings> = {}, opts: { indexDir?: string; ocrEngine?: OcrEngine } = {}): Promise<void> {
        // Unique DB name per Scenario so tests don't share an origin-scoped
        // IndexedDB (fake-indexeddb is ONE global, exactly like the browser). The
        // uniqueness MUST go in `scope`, not `dbPrefix`: open() only rewrites the
        // db name when scope is truthy (`${dbPrefix}:${scope}`), so a dbPrefix-only
        // call silently keeps the default name and every scenario would collide.
        await this.store.open(`scn-${Math.random().toString(36).slice(2)}`, 'seeker-test');
        const self = this;
        const app = {
            vault: this.vault,
            metadataCache: { isUserIgnored: () => false, get resolvedLinks() { return self.resolvedLinks; } },
        } as unknown as App;
        // The orchestrator calls append / appendError / deviceId (grep-pinned).
        const logger = {
            deviceId: 'test',
            append: async (e: LogEntry) => { this.logEntries.push(e); },
            appendError: async () => {},
        } as never;
        this.orch = new SearchOrchestrator(app, this.store, this.embedder, logger, { ...structuredClone(DEFAULT_SETTINGS), ...settings }, null, opts.indexDir ?? null);
        if (opts.ocrEngine) this.orch.setOcrEngine(opts.ocrEngine);
    }

    // Run the desktop OCR pre-pass over every live indexable file, then a cold
    // build — the real desktop order (pre-pass fills the cache, the embed loop
    // sees only hits). Returns after the index reflects the OCR'd images.
    async ocrColdStart(): Promise<void> {
        await this.orch.ocrPrepass(this.vault.getFiles());
        await this.orch.reindexAll();
    }

    // The incremental catch-up the live handlers run: diff persisted vs live,
    // then patch. embed=true mirrors the desktop flushDirty (model already warm).
    // Public so a scenario can re-reconcile with no vault change (convergence:
    // a second reconcile must find nothing dirty and not rebuild).
    async reconcile(embed = true): Promise<void> {
        const { dirty, deleted } = await this.orch.computeDelta();
        await this.orch.reindexDelta(dirty, deleted, { embed });
    }

    // NOTE: the incremental helpers below embed only once identity is stamped.
    // reindexDelta defers the embed phase as a model-drift guard when the store's
    // meta.modelId is unset (an empty store reads as legacy english-r2 ≠ the live
    // model), exactly as it does in production — you cannot incrementally embed
    // into an index whose identity was never claimed. So a scenario indexes the
    // initial corpus with coldStart() (the real first-index path), then uses these
    // for subsequent changes.
    create = async (p: string, body: string, t: number): Promise<void> => { this.vault.write(p, body, t); await this.reconcile(); };
    edit   = async (p: string, body: string, t: number): Promise<void> => { this.vault.write(p, body, t); await this.reconcile(); };
    touch  = async (p: string, t: number): Promise<void> => { this.vault.touch(p, t); await this.reconcile(); };
    del    = async (p: string): Promise<void> => { this.vault.remove(p); await this.reconcile(); };

    // The empty-store cold build — the path that historically ran incremental and
    // never stamped identity, re-healing forever.
    coldStart = (): Promise<unknown> => this.orch.reindexAll();

    async teardown(): Promise<void> {
        // dispose() signals any in-flight embed loop to stop. We deliberately do
        // NOT close the store: each Scenario opens a uniquely-named DB (see boot),
        // so a lingering connection can't versionchange a later one, and leaving it
        // open lets search()'s fire-and-forget warmCaches finish without throwing
        // "IndexStore not opened" against a store we yanked out from under it.
        this.orch?.dispose();
    }
}
