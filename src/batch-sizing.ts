// Embed batch sizing — the ONE source for how many chunks a per-bucket rolling
// buffer flushes per dispatch (search.ts) and, derived from that, the exact
// (batch × seq) shape set the iframe warms (iframe-runner.ts) and the parent
// fingerprints (embedder.ts). Pure and Obsidian-free so every consumer can
// unit-test against it.
//
// ONE sizing on every platform × device (decision 2026-09-03, ticket
// nid_wzsj2sawjazdxakqi8czjh0sc_e, which reverted the desktop-WebGPU 2048/32
// tier + the focus-aware pacing that handed it out):
//   - A dispatch is non-preemptible; the worst-case UI stall is the largest
//     dispatch's forward time, and budgetTokens ≈ batch × seq caps exactly that.
//   - On WASM the forward runs synchronously on the iframe's thread, so the
//     budget is ALSO the main-thread stall per dispatch, and batch size was
//     measured a wash for throughput (search.ts, "WASM batch experiment
//     CLOSED 2026-06-11").
//   - Mobile: 8 is the thermal-friendly ceiling (large batches spike a phone's
//     GPU power envelope and the throttle slows the whole index).
//   - Desktop WebGPU has headroom (2048/32 measured −17.5 % wall-clock on one
//     GPU; docs/perf-bench.md), but only while nobody is looking — a focused
//     window must keep this stall cap — and the tier machinery (focus polling,
//     a user setting, a per-GPU constant to re-sweep on every model change)
//     was judged not worth an unfocused-only win. WHY-NOT a second tier: that
//     is exactly what was reverted; re-read the ticket before re-adding one.

export interface BatchSizing {
    // Target batch × seq per dispatch: the stall cap. Big seq buckets flush at a
    // small batch, small buckets at maxBatch.
    readonly budgetTokens: number;
    // Ceiling on chunks per dispatch regardless of bucket.
    readonly maxBatch: number;
}

// 512/8 → {512:1, 384:1, 256:2, 192:3, 128:4, 96:5, ≤64:8}. Every consumer
// (flush size, warmup grid, warmup fingerprint) follows this one value, so a
// change here can never dispatch an un-warmed shape. Lower the budget to cut
// the p95 stall further (more dispatches); raise it for throughput.
export const BATCH_SIZING: BatchSizing = { budgetTokens: 512, maxBatch: 8 };

// Flush size for one seq bucket: hold batch × seq ≈ budget, clamped to
// [1, maxBatch]. Every value this returns — and every remainder 1..value-1 a
// partial bucket drains at — must be in the warmed grid (warmupGridFor).
export function rollingBatchFor(bucket: number, sizing: BatchSizing): number {
    return Math.max(1, Math.min(sizing.maxBatch, Math.round(sizing.budgetTokens / bucket)));
}

// One warmup cell: the iframe compiles (n × bucket) for every n in 1..maxBatch.
export interface WarmupCell {
    readonly bucket: number;
    readonly maxBatch: number;
}
export type WarmupGrid = ReadonlyArray<WarmupCell>;

// The exact shape set the indexer can dispatch under `sizing`: per bucket, the
// flush size plus the drain remainders below it. Derived PER BUCKET rather
// than as the cross product [1..maxBatch] × buckets because a big bucket never
// flushes anywhere near maxBatch — at 512/8 that is 40 passes instead of 72,
// and each cold pass is a ~12 ms WGSL compile.
export function warmupGridFor(sizing: BatchSizing, seqBuckets: ReadonlyArray<number>): WarmupGrid {
    return seqBuckets.map(bucket => ({ bucket, maxBatch: rollingBatchFor(bucket, sizing) }));
}

// Total forward passes a cold warmup of `grid` runs. Diagnostics only.
export function warmupPassCount(grid: WarmupGrid): number {
    return grid.reduce((n, cell) => n + cell.maxBatch, 0);
}

// Stable text form for the warmup-skip fingerprint (embedder.ts): a grid
// change must never let an old fingerprint skip un-warmed shapes.
export function warmupGridKey(grid: WarmupGrid): string {
    return grid.map(cell => `${cell.bucket}:${cell.maxBatch}`).join(',');
}
