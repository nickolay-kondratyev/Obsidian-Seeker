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
    // SeekerSettings.performanceMode — desktop-only preference.
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
}

export function pacingPolicyFor(inputs: PacingInputs): PacingDecision {
    // Hidden has no compositor to defer to on any platform (pacer.ts, issue #5).
    if (inputs.hidden) return fullSpeed(inputs);
    if (inputs.isMobile) return gated();
    if (inputs.performanceMode || !inputs.focused) return fullSpeed(inputs);
    return gated();
}

// Focused desktop / visible mobile: today's behaviour.
function gated(): PacingDecision {
    return { idleGate: true, sizing: BASE_BATCH_SIZING };
}

// Nobody to stall: the largest tier this (platform, device) is warmed for —
// which is still the base tier on mobile and desktop-WASM (batchSizingFor).
function fullSpeed(inputs: PacingInputs): PacingDecision {
    return { idleGate: false, sizing: batchSizingFor({ isMobile: inputs.isMobile, device: inputs.device }) };
}
