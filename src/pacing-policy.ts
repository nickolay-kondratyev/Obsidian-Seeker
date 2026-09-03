// PacingPolicy — the ONE decision per embed dispatch of (a) whether to wait for
// a compositor idle window before the next dispatch and (b) which batch sizing
// tier to flush with. Pure and Obsidian-free: search.ts feeds it the live
// inputs (pacer.ts windowStateNow, platform.ts isMobilePlatform, the embedder's
// resolved device, the Performance-mode setting) and both the flush size and
// the pacer follow the returned decision, so the two can never disagree.
//
// Lever 2 of the indexing-perf plan (ticket nid_td0kh5ezmq4tkfmhfx82d1pcr_e).
// The default is "do not stall the app": a FOCUSED desktop window keeps
// today's behaviour byte-for-byte (rIC idle gate + the base 512/8 sizing whose
// p95 dispatch is ≈ 17 ms), because the user is typing into it. An UNFOCUSED or
// HIDDEN window has nobody to stall — the compositor either has no frames to
// produce (hidden) or is producing them for another app's window — so it takes
// the full desktop-WebGPU tier (2048/32, −17.5 % wall-clock, p95 56 ms) with
// only a cheap thread yield between dispatches. Performance mode is the user
// opting into the unfocused behaviour while focused ("index at full speed even
// while you type").
//
// Mobile is byte-identical to pre-lever-2: hidden already took the cheap yield
// (pacer.ts, issue #5), a visible window is always gated (there is no separate
// desktop-style focus on a phone, and the Performance-mode toggle is not
// offered there), and sizing is always the base tier (thermal ceiling —
// batch-sizing.ts).
//
// Tier switching needs no re-warm: batchSizingFor gives the LARGEST tier a
// (platform, device) can flush with, the embedder warms that grid, and the base
// grid is a per-bucket subset of it (pinned in batch-sizing.test.ts and
// pacing-policy.test.ts). So the decision may change from one dispatch to the
// next on a focus change without leaving the warmed shape set.
import type { Device } from './types';
import { BASE_BATCH_SIZING, batchSizingFor, type BatchSizing } from './batch-sizing';

export interface PacingInputs {
    readonly isMobile: boolean;
    readonly device: Device;
    // SeekSettings.performanceMode — desktop-only preference.
    readonly performanceMode: boolean;
    // activeDocument.hasFocus(): the Obsidian window owns keyboard focus.
    readonly focused: boolean;
    // activeDocument.hidden: no compositor at all (minimised / other tab).
    readonly hidden: boolean;
}

export interface PacingDecision {
    // true → wait for a requestIdleCallback slice before the next dispatch
    // (CompositorPacer's rIC path); false → cheap thread yield only.
    readonly idleGate: boolean;
    // The flush sizing for the next dispatch.
    readonly sizing: BatchSizing;
    // How many embed dispatches may be outstanding at once (search.ts flush
    // loop). 1 = serial (dispatch, await, commit); 2 = the next batch is
    // dispatched before the previous one's vectors land.
    readonly dispatchDepth: number;
}

// Serial dispatch: every surface's behaviour before the overlap experiment.
export const SINGLE_FLIGHT = 1;
// EXPERIMENT (ticket nid_shw3c2udyuva92sa81oa5qxyg_e): two-deep dispatch overlap
// on the full-speed desktop-WebGPU tier only. ORT-Web serialises forward passes
// on one device queue, so the second dispatch can only hide the CPU-side gap
// between passes (chunk + tokenCounts of the next files, the postMessage
// round-trip, quantize + IndexedDB commit). Gated tier stays serial: the rIC
// yield exists to leave the compositor an idle GPU, and a queued second
// dispatch would fill exactly that window. Mobile stays serial for memory
// (two batches of transferables in flight) and thermals. Desktop-WASM stays
// serial: the forward runs synchronously on the iframe thread, so a second
// outstanding RPC just queues behind it. Value pending the host bench
// (docs/perf-bench.md, "Experiment — two-deep dispatch overlap").
export const DESKTOP_WEBGPU_DISPATCH_DEPTH = 2;

export function pacingPolicyFor(inputs: PacingInputs): PacingDecision {
    // Hidden has no compositor to defer to on any platform (pacer.ts, issue #5).
    if (inputs.hidden) return fullSpeed(inputs);
    if (inputs.isMobile) return gated();
    if (inputs.performanceMode || !inputs.focused) return fullSpeed(inputs);
    return gated();
}

// Focused desktop / visible mobile: today's behaviour.
function gated(): PacingDecision {
    return { idleGate: true, sizing: BASE_BATCH_SIZING, dispatchDepth: SINGLE_FLIGHT };
}

// Nobody to stall: the largest tier this (platform, device) is warmed for —
// which is still the base tier on mobile and desktop-WASM (batchSizingFor).
function fullSpeed(inputs: PacingInputs): PacingDecision {
    const desktopWebgpu = !inputs.isMobile && inputs.device === 'webgpu';
    return {
        idleGate: false,
        sizing: batchSizingFor({ isMobile: inputs.isMobile, device: inputs.device }),
        dispatchDepth: desktopWebgpu ? (desktopWebgpuDispatchDepthOverride ?? DESKTOP_WEBGPU_DISPATCH_DEPTH) : SINGLE_FLIGHT,
    };
}

// Bench-only knob (`BENCH_DISPATCH_DEPTH`, bench/harness/page.ts): swaps the
// desktop-WebGPU dispatch depth for this process so the host can measure
// depth 1 vs 2 on one commit (scripts/bench-overlap.mjs). Never called by
// production code; `null` clears. Mirrors overrideDesktopWebgpuSizing.
let desktopWebgpuDispatchDepthOverride: number | null = null;
export function overrideDesktopWebgpuDispatchDepth(depth: number | null): void {
    if (depth !== null && (!Number.isInteger(depth) || depth < SINGLE_FLIGHT)) throw new Error(`dispatch depth must be an integer ≥ ${SINGLE_FLIGHT}, got ${depth}`);
    desktopWebgpuDispatchDepthOverride = depth;
}
