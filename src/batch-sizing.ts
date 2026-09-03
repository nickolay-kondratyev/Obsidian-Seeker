// Embed batch sizing — the ONE source for how many chunks a per-bucket rolling
// buffer flushes per dispatch (search.ts) and, derived from that, the exact
// (batch × seq) shape set the iframe warms (iframe-runner.ts) and the parent
// fingerprints (embedder.ts). Pure and Obsidian-free so every consumer can
// unit-test against it; platform.ts hands in `isMobile`, the embedder hands in
// the resolved device.
//
// Why sizing is a (platform, device) pair and not a platform alone
// (ticket nid_0yhtxzgrmly7zk6m6quiqfpil_e, lever 1 of the indexing-perf plan):
//   - A dispatch is non-preemptible; the worst-case UI stall is the largest
//     dispatch's forward time, and budgetTokens ≈ batch × seq caps exactly that.
//   - On WASM the forward runs synchronously on the iframe's thread, so the
//     budget is ALSO the main-thread stall per dispatch, and batch size was
//     measured a wash for throughput (search.ts, "WASM batch experiment
//     CLOSED 2026-06-11"). Desktop-WASM is where Linux users without the
//     WebGPU flags sit, so it keeps the base sizing byte-for-byte.
//   - Mobile keeps the base sizing on every device: 8 is the thermal-friendly
//     ceiling (platform.ts history: large batches spike a phone's GPU power
//     envelope and the throttle slows the whole index).
//   - Desktop + WebGPU is the only surface with headroom: the GPU runs the
//     forward asynchronously and the baseline showed an effective batch of 2.4
//     against a cap of 8 because the 512-token budget closes a batch after
//     ~2.4 chunks (docs/perf-bench.md, "Reading the baseline").
import type { Device } from './types';

export interface BatchSizing {
    // Target batch × seq per dispatch: the stall cap. Big seq buckets flush at a
    // small batch, small buckets at maxBatch.
    readonly budgetTokens: number;
    // Ceiling on chunks per dispatch regardless of bucket.
    readonly maxBatch: number;
}

export interface BatchSizingContext {
    readonly isMobile: boolean;
    readonly device: Device;
}

// Today's production sizing on every surface before lever 1. 512 → {512:1,
// 384:1, 256:2, 192:3, 128:4, 96:5, ≤64:8}.
export const BASE_BATCH_SIZING: BatchSizing = { budgetTokens: 512, maxBatch: 8 };

// PROVISIONAL (2026-09-03): the middle of the ticket's candidate set
// (budget 1024/2048/4096 × max 16/32) pending the host WebGPU bench sweep —
// see the ticket for the sweep procedure and the ≥10 %-median acceptance
// rule in docs/perf-bench.md. Replace with the measured winner; every
// consumer (flush size, warmup grid, fingerprint) follows this one value.
// 2048/16 → {512:4, 384:5, 256:8, 192:11, 128:16, ≤96:16}.
export const DESKTOP_WEBGPU_BATCH_SIZING: BatchSizing = { budgetTokens: 2048, maxBatch: 16 };

export function batchSizingFor(ctx: BatchSizingContext): BatchSizing {
    if (!ctx.isMobile && ctx.device === 'webgpu') return DESKTOP_WEBGPU_BATCH_SIZING;
    return BASE_BATCH_SIZING;
}

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
// flushes anywhere near maxBatch — at 2048/16 that is 108 passes instead of
// 144, and each cold pass is a ~50 ms WGSL compile.
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
