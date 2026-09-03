// Lever 1 (nid_0yhtxzgrmly7zk6m6quiqfpil_e): the (platform × device) batch
// sizing and the warmup grid derived from it. The invariant that matters most
// is the last describe: every batch size the indexer can dispatch — the flush
// size AND every drain remainder below it — is a warmed shape.
import { describe, it, expect } from 'vitest';
import {
    BASE_BATCH_SIZING,
    DESKTOP_WEBGPU_BATCH_SIZING,
    batchSizingFor,
    rollingBatchFor,
    warmupGridFor,
    warmupPassCount,
    warmupGridKey,
    type BatchSizing,
} from './batch-sizing';
import { SEQ_BUCKETS } from './iframe-runner';

describe('batchSizingFor — only desktop+WebGPU gets the larger sizing', () => {
    it('mobile + webgpu keeps the base sizing (thermal ceiling)', () => {
        expect(batchSizingFor({ isMobile: true, device: 'webgpu' })).toEqual({ budgetTokens: 512, maxBatch: 8 });
    });
    it('mobile + wasm keeps the base sizing', () => {
        expect(batchSizingFor({ isMobile: true, device: 'wasm' })).toEqual({ budgetTokens: 512, maxBatch: 8 });
    });
    it('desktop + wasm keeps the base sizing (budget caps the synchronous stall; batch is a wash)', () => {
        expect(batchSizingFor({ isMobile: false, device: 'wasm' })).toEqual({ budgetTokens: 512, maxBatch: 8 });
    });
    it('desktop + webgpu gets DESKTOP_WEBGPU_BATCH_SIZING', () => {
        expect(batchSizingFor({ isMobile: false, device: 'webgpu' })).toBe(DESKTOP_WEBGPU_BATCH_SIZING);
    });
    it('the desktop-WebGPU sizing is strictly larger than base on both axes', () => {
        expect(DESKTOP_WEBGPU_BATCH_SIZING.budgetTokens).toBeGreaterThan(BASE_BATCH_SIZING.budgetTokens);
        expect(DESKTOP_WEBGPU_BATCH_SIZING.maxBatch).toBeGreaterThan(BASE_BATCH_SIZING.maxBatch);
    });
});

describe('rollingBatchFor — base sizing reproduces the pre-lever flush sizes', () => {
    // {512:1, 384:1, 256:2, 192:3, 128:4, 96:5, ≤64:8} — the numbers the
    // baseline in docs/perf-bench.md was captured with.
    it.each([
        [512, 1], [384, 1], [256, 2], [192, 3], [128, 4], [96, 5], [64, 8], [48, 8], [32, 8],
    ])('bucket %i → %i', (bucket, expected) => {
        expect(rollingBatchFor(bucket, BASE_BATCH_SIZING)).toBe(expected);
    });
    it('never exceeds maxBatch on a tiny bucket', () => {
        expect(rollingBatchFor(8, { budgetTokens: 4096, maxBatch: 16 })).toBe(16);
    });
    it('never drops below 1 on an oversized bucket', () => {
        expect(rollingBatchFor(4096, { budgetTokens: 512, maxBatch: 8 })).toBe(1);
    });
});

describe('warmupGridFor — one cell per seq bucket, sized by rollingBatchFor', () => {
    const gridBase = warmupGridFor(BASE_BATCH_SIZING, SEQ_BUCKETS);

    it('covers every SEQ_BUCKETS entry exactly once, in ladder order', () => {
        expect(gridBase.map(c => c.bucket)).toEqual(SEQ_BUCKETS);
    });
    it('base grid is 40 passes (the pre-lever [1..8] × 9 cross product was 72)', () => {
        expect(warmupPassCount(gridBase)).toBe(40);
    });
    it('desktop-WebGPU grid stays well under the [1..max] × buckets cross product', () => {
        const grid = warmupGridFor(DESKTOP_WEBGPU_BATCH_SIZING, SEQ_BUCKETS);
        expect(warmupPassCount(grid)).toBeLessThan(DESKTOP_WEBGPU_BATCH_SIZING.maxBatch * SEQ_BUCKETS.length);
    });
    it('every cell warms at least batch 1 (the query path relies on (1 × bucket) being warm)', () => {
        for (const cell of warmupGridFor(DESKTOP_WEBGPU_BATCH_SIZING, SEQ_BUCKETS)) expect(cell.maxBatch).toBeGreaterThanOrEqual(1);
    });
    it('warmupGridKey changes when the sizing changes (fingerprint must re-warm)', () => {
        expect(warmupGridKey(gridBase)).not.toBe(warmupGridKey(warmupGridFor(DESKTOP_WEBGPU_BATCH_SIZING, SEQ_BUCKETS)));
    });
    it('warmupGridKey is a stable, readable bucket:max list', () => {
        expect(warmupGridKey(gridBase)).toBe('32:8,48:8,64:8,96:5,128:4,192:3,256:2,384:1,512:1');
    });
});

// The drain-remainders invariant: for each sizing the indexer can run under,
// every shape it can emit — flushBucket's rollingBatchFor(bucket) and every
// partial-drain remainder 1..that-1 — must be inside the warmed grid, or the
// first live dispatch of that shape pays a WGSL compile (and, historically,
// risked the ORT-Web SafeInt overflow on arbitrary shapes).
describe('every dispatchable (batch, bucket) shape is warmed', () => {
    const sizings: Array<[string, BatchSizing]> = [
        ['base', BASE_BATCH_SIZING],
        ['desktop-webgpu', DESKTOP_WEBGPU_BATCH_SIZING],
    ];
    it.each(sizings)('%s: flush size and all remainders are in the grid', (_name, sizing) => {
        const grid = warmupGridFor(sizing, SEQ_BUCKETS);
        const warmedMax = new Map(grid.map(c => [c.bucket, c.maxBatch]));
        for (const bucket of SEQ_BUCKETS) {
            const flush = rollingBatchFor(bucket, sizing);
            for (let n = 1; n <= flush; n++) {
                expect(warmedMax.get(bucket) ?? 0, `batch ${n} × seq ${bucket}`).toBeGreaterThanOrEqual(n);
            }
        }
    });
    it('the base grid is a subset of the desktop-WebGPU grid (a mid-pass webgpu→wasm recycle stays warmed)', () => {
        const base = warmupGridFor(BASE_BATCH_SIZING, SEQ_BUCKETS);
        const desktop = new Map(warmupGridFor(DESKTOP_WEBGPU_BATCH_SIZING, SEQ_BUCKETS).map(c => [c.bucket, c.maxBatch]));
        for (const cell of base) expect(desktop.get(cell.bucket) ?? 0).toBeGreaterThanOrEqual(cell.maxBatch);
    });
});
