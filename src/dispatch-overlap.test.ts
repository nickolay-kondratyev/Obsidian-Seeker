// Two-deep embed dispatch overlap (experiment nid_shw3c2udyuva92sa81oa5qxyg_e):
// the flush loop in search.ts keeps up to PacingDecision.dispatchDepth
// embedBatch RPCs outstanding. These pin the invariants the ticket demands at
// depth 2: the depth cap itself, settle/commit order = dispatch order even when
// the newer dispatch lands first, and the recycle+retry redesign (drain the
// other in-flight dispatch BEFORE recycling; each dispatch retried at most
// once; a DISPOSED rejection still unwinds the pass without a recycle).
import { describe, it, expect, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { Scenario } from './test-harness/scenario';
import { DESKTOP_WEBGPU_BATCH_SIZING } from './batch-sizing';
import { DESKTOP_WEBGPU_DISPATCH_DEPTH, SINGLE_FLIGHT } from './pacing-policy';
import type { IndexCompleteEntry } from './types';

type G = { activeDocument?: { hidden: boolean; hasFocus: () => boolean } };
const g = globalThis as unknown as G;

type EmbedResult = { vectors: Float32Array[]; iframeLatencyMs: number };
type FakeEmbedder = {
    device: 'webgpu' | 'wasm';
    embedBatch: (texts: string[], ...rest: unknown[]) => Promise<EmbedResult>;
    recycle: () => Promise<void>;
};

function disposedError(): Error {
    return Object.assign(new Error('iframe disposed'), { code: 'DISPOSED' });
}

// Distinct mtimes so the pass order (recency-first) is n0, n1, … and every
// note is one chunk in the smallest seq bucket (flush size = the tier's
// maxBatch). FILES = one full desktop-WebGPU flush + a drain remainder, i.e.
// exactly two dispatches at depth 2.
const FULL_FLUSH = DESKTOP_WEBGPU_BATCH_SIZING.maxBatch;
const FILES = FULL_FLUSH + 8;
function writeNotes(s: Scenario, n: number): void {
    for (let i = 0; i < n; i++) s.vault.write(`n${i}.md`, `short note ${i} about tea`, 10_000 - i);
}
function expectedPassOrder(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `n${i}.md`);
}

// One embedBatch call the test controls: `arrived` is the dispatch index,
// `release` resolves it with real vectors, `fail` rejects it.
interface Call {
    texts: string[];
    release: () => void;
    fail: (e: Error) => void;
}

// Wraps the scenario's fake embedder so every dispatch becomes a Call, and
// records the concurrency the orchestrator actually produced. `script` runs
// once per arriving call and decides when it settles; calls it does not
// settle synchronously stay pending until a later script invocation releases
// them (that is how a test forces the newer dispatch to land first).
class DispatchScript {
    calls: Call[] = [];
    inFlight = 0;
    maxInFlight = 0;
    // Every recycle() with the in-flight count and the number of dispatches
    // seen so far. A full WebGPU reindex ends with the post-index buffer-pool
    // reclaim (search.ts, 'post-index-recycle'), which is also a recycle():
    // midPassRecycles counts only those that ran before the last dispatch.
    recycleLog: Array<{ inFlight: number; callsSoFar: number }> = [];
    get midPassRecycles(): Array<{ inFlight: number; callsSoFar: number }> {
        return this.recycleLog.filter(r => r.callsSoFar < this.calls.length);
    }
    constructor(e: FakeEmbedder, private script: (call: Call, index: number, s: DispatchScript) => void) {
        const real = e.embedBatch.bind(e);
        e.embedBatch = (texts, ...rest) => new Promise<EmbedResult>((resolve, reject) => {
            this.inFlight++;
            this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
            const settle = (): void => { this.inFlight--; };
            const call: Call = {
                texts,
                release: () => { settle(); real(texts, ...rest).then(resolve, reject); },
                fail: (err) => { settle(); reject(err); },
            };
            this.calls.push(call);
            script(call, this.calls.length - 1, this);
        });
        e.recycle = async () => { this.recycleLog.push({ inFlight: this.inFlight, callsSoFar: this.calls.length }); };
    }
}

// Release the call on the next macrotask — an ordering yield that gives the
// orchestrator's loop the chance to dispatch the NEXT batch while this one is
// still outstanding (a microtask-immediate release would never overlap).
function releaseLater(call: Call): void {
    setTimeout(() => call.release(), 0);
}

describe('flush loop dispatch overlap', () => {
    let active: Scenario | null = null;
    afterEach(async () => {
        await active?.teardown(); active = null;
        Platform.isMobile = false;
        delete g.activeDocument;
    });

    async function boot(opts: { mobile?: boolean; focused: boolean; device: 'webgpu' | 'wasm' }): Promise<{ s: Scenario; e: FakeEmbedder; committed: string[] }> {
        Platform.isMobile = opts.mobile ?? false;
        g.activeDocument = { hidden: false, hasFocus: () => opts.focused };
        const s = new Scenario();
        await s.boot();
        active = s;
        const e = s.embedder as unknown as FakeEmbedder;
        e.device = opts.device;
        // Commit order, as the store sees it (one putBatchQuantized per file).
        const committed: string[] = [];
        const realPut = s.store.putBatchQuantized.bind(s.store);
        s.store.putBatchQuantized = async (chunks, tiers, record) => { if (record) committed.push(record.note_path); return realPut(chunks, tiers, record); };
        writeNotes(s, FILES);
        return { s, e, committed };
    }

    describe('depth cap follows the policy', () => {
        it('unfocused desktop-WebGPU overlaps two dispatches and never more', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            const script = new DispatchScript(e, call => releaseLater(call));
            const entry: IndexCompleteEntry = await s.orch.reindexAll();
            expect({ observed: script.maxInFlight, reported: entry.embedMaxInFlight })
                .toEqual({ observed: DESKTOP_WEBGPU_DISPATCH_DEPTH, reported: DESKTOP_WEBGPU_DISPATCH_DEPTH });
        });
        it('focused desktop-WebGPU (gated tier) stays single-flight', async () => {
            const { s, e } = await boot({ focused: true, device: 'webgpu' });
            const script = new DispatchScript(e, call => releaseLater(call));
            await s.orch.reindexAll();
            expect(script.maxInFlight).toBe(SINGLE_FLIGHT);
        });
        it('unfocused desktop-WASM stays single-flight', async () => {
            const { s, e } = await boot({ focused: false, device: 'wasm' });
            const script = new DispatchScript(e, call => releaseLater(call));
            await s.orch.reindexAll();
            expect(script.maxInFlight).toBe(SINGLE_FLIGHT);
        });
        it('mobile stays single-flight even ungated', async () => {
            const { s, e } = await boot({ mobile: true, focused: false, device: 'webgpu' });
            g.activeDocument = { hidden: true, hasFocus: () => false };
            const script = new DispatchScript(e, call => releaseLater(call));
            await s.orch.reindexAll();
            expect(script.maxInFlight).toBe(SINGLE_FLIGHT);
        });
    });

    describe('settle order = dispatch order', () => {
        // Dispatch 0 is held until dispatch 1 has ARRIVED and been released, so
        // the newer batch's vectors land first; the files must still commit in
        // pass order (dispatch 0's files before dispatch 1's).
        function newerLandsFirst(): (call: Call, index: number) => void {
            let first: Call | null = null;
            return (call, index) => {
                if (index === 0) { first = call; return; }
                call.release();
                setTimeout(() => first?.release(), 0);
            };
        }
        it('commits every file in pass order when the newer dispatch lands first', async () => {
            const { s, e, committed } = await boot({ focused: false, device: 'webgpu' });
            new DispatchScript(e, newerLandsFirst());
            await s.orch.reindexAll();
            expect(committed).toEqual(expectedPassOrder(FILES));
        });
        it('the two dispatches really overlapped in that run', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            const script = new DispatchScript(e, newerLandsFirst());
            await s.orch.reindexAll();
            expect(script.maxInFlight).toBe(2);
        });
        it('every file commits and none is skipped', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            new DispatchScript(e, newerLandsFirst());
            const entry = await s.orch.reindexAll();
            expect({ committed: entry.committedFilePaths.length, skipped: entry.filesSkippedError }).toEqual({ committed: FILES, skipped: 0 });
        });
    });

    describe('recycle+retry with another dispatch in flight', () => {
        // Dispatch 0 fails (recoverable) while dispatch 1 is outstanding;
        // dispatch 1 lands on its own after a macrotask.
        function firstFails(secondOutcome: 'lands' | 'fails'): (call: Call, index: number) => void {
            return (call, index) => {
                if (index === 0) { call.fail(new Error('simulated SafeInt overflow')); return; }
                if (index === 1 && secondOutcome === 'fails') { setTimeout(() => call.fail(new Error('same poisoned device')), 0); return; }
                releaseLater(call);
            };
        }
        it('recycles exactly once, only after the other dispatch settled', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            const script = new DispatchScript(e, firstFails('lands'));
            const entry = await s.orch.reindexAll();
            expect({ inFlightAtRecycle: script.midPassRecycles.map(r => r.inFlight), reported: entry.embedRecycles })
                .toEqual({ inFlightAtRecycle: [0], reported: 1 });
        });
        it('retries only the failed dispatch when the other one landed', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            const script = new DispatchScript(e, firstFails('lands'));
            await s.orch.reindexAll();
            // 2 originals + 1 retry of dispatch 0 (dispatch 1's vectors are kept).
            expect(script.calls.map(c => c.texts.length)).toEqual([FULL_FLUSH, FILES - FULL_FLUSH, FULL_FLUSH]);
        });
        it('retries both when the other dispatch failed on the same device, after one recycle', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            const script = new DispatchScript(e, firstFails('fails'));
            const entry = await s.orch.reindexAll();
            expect({ recycles: script.midPassRecycles.length, calls: script.calls.map(c => c.texts.length), skipped: entry.filesSkippedError })
                .toEqual({ recycles: 1, calls: [FULL_FLUSH, FILES - FULL_FLUSH, FULL_FLUSH, FILES - FULL_FLUSH], skipped: 0 });
        });
        it('still commits every file in pass order', async () => {
            const { s, e, committed } = await boot({ focused: false, device: 'webgpu' });
            new DispatchScript(e, firstFails('fails'));
            await s.orch.reindexAll();
            expect(committed).toEqual(expectedPassOrder(FILES));
        });
        it('a retried dispatch that fails again goes to the solo path without a second recycle', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            // Dispatch 0 fails, is retried after the recycle (call 2) and fails
            // again → its chunks are solo-embedded; solo calls succeed.
            const script = new DispatchScript(e, (call, index) => {
                if (index === 0 || index === 2) { call.fail(new Error('overflow')); return; }
                releaseLater(call);
            });
            const entry = await s.orch.reindexAll();
            const soloCalls = script.calls.filter(c => c.texts.length === 1).length;
            expect({ recycles: script.midPassRecycles.length, soloCalls, committed: entry.committedFilePaths.length, skipped: entry.filesSkippedError })
                .toEqual({ recycles: 1, soloCalls: FULL_FLUSH, committed: FILES, skipped: 0 });
        });
    });

    describe('DISPOSED unwinds the pass without recycling', () => {
        it('when the failing dispatch is the disposed one', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            const script = new DispatchScript(e, (call, index) => {
                if (index === 0) { call.fail(disposedError()); return; }
                releaseLater(call);
            });
            await expect(s.orch.reindexAll()).rejects.toMatchObject({ code: 'DISPOSED' });
            expect(script.recycleLog).toEqual([]);
        });
        it('when the other in-flight dispatch is disposed during the drain', async () => {
            const { s, e } = await boot({ focused: false, device: 'webgpu' });
            const script = new DispatchScript(e, (call, index) => {
                if (index === 0) { call.fail(new Error('overflow')); return; }
                if (index === 1) { setTimeout(() => call.fail(disposedError()), 0); return; }
                releaseLater(call);
            });
            await expect(s.orch.reindexAll()).rejects.toMatchObject({ code: 'DISPOSED' });
            expect(script.recycleLog).toEqual([]);
        });
    });
});
