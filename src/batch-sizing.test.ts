// The one batch sizing and the warmup grid derived from it. The invariant that
// matters most is the last describe: every batch size the indexer can dispatch
// — the flush size AND every drain remainder below it — is a warmed shape.
import { describe, it, expect } from 'vitest';
import {
    BATCH_SIZING,
    rollingBatchFor,
    warmupGridFor,
    warmupPassCount,
    warmupGridKey,
} from './batch-sizing';
import { SEQ_BUCKETS } from './iframe-runner';

describe('rollingBatchFor — the shipped sizing reproduces the baseline flush sizes', () => {
    // {512:1, 384:1, 256:2, 192:3, 128:4, 96:5, ≤64:8} — the numbers the
    // baseline in docs/perf-bench.md was captured with.
    it.each([
        [512, 1], [384, 1], [256, 2], [192, 3], [128, 4], [96, 5], [64, 8], [48, 8], [32, 8],
    ])('bucket %i → %i', (bucket, expected) => {
        expect(rollingBatchFor(bucket, BATCH_SIZING)).toBe(expected);
    });
    it('never exceeds maxBatch on a tiny bucket', () => {
        expect(rollingBatchFor(8, { budgetTokens: 4096, maxBatch: 16 })).toBe(16);
    });
    it('never drops below 1 on an oversized bucket', () => {
        expect(rollingBatchFor(4096, { budgetTokens: 512, maxBatch: 8 })).toBe(1);
    });
});

describe('warmupGridFor — one cell per seq bucket, sized by rollingBatchFor', () => {
    const grid = warmupGridFor(BATCH_SIZING, SEQ_BUCKETS);

    it('covers every SEQ_BUCKETS entry exactly once, in ladder order', () => {
        expect(grid.map(c => c.bucket)).toEqual(SEQ_BUCKETS);
    });
    it('is 40 passes (the old flat [1..8] × 9 cross product was 72)', () => {
        expect(warmupPassCount(grid)).toBe(40);
    });
    it('every cell warms at least batch 1 (the query path relies on (1 × bucket) being warm)', () => {
        for (const cell of grid) expect(cell.maxBatch).toBeGreaterThanOrEqual(1);
    });
    it('warmupGridKey changes when the sizing changes (fingerprint must re-warm)', () => {
        expect(warmupGridKey(grid)).not.toBe(warmupGridKey(warmupGridFor({ budgetTokens: 2048, maxBatch: 32 }, SEQ_BUCKETS)));
    });
    it('warmupGridKey is a stable, readable bucket:max list', () => {
        expect(warmupGridKey(grid)).toBe('32:8,48:8,64:8,96:5,128:4,192:3,256:2,384:1,512:1');
    });
});

// The drain-remainders invariant: every shape the indexer can emit —
// flushBucket's rollingBatchFor(bucket) and every partial-drain remainder
// 1..that-1 — must be inside the warmed grid, or the first live dispatch of
// that shape pays a WGSL compile (and, historically, risked the ORT-Web
// SafeInt overflow on arbitrary shapes).
describe('every dispatchable (batch, bucket) shape is warmed', () => {
    it('flush size and all remainders are in the grid', () => {
        const warmedMax = new Map(warmupGridFor(BATCH_SIZING, SEQ_BUCKETS).map(c => [c.bucket, c.maxBatch]));
        for (const bucket of SEQ_BUCKETS) {
            const flush = rollingBatchFor(bucket, BATCH_SIZING);
            for (let n = 1; n <= flush; n++) {
                expect(warmedMax.get(bucket) ?? 0, `batch ${n} × seq ${bucket}`).toBeGreaterThanOrEqual(n);
            }
        }
    });
});
