// Lever 2 (nid_td0kh5ezmq4tkfmhfx82d1pcr_e): the (mobile, device, Performance
// mode, focus, hidden) → (idleGate, sizing) policy. The human-decided default
// is "do not stall the app": focused desktop = today's gated 512/8; unfocused /
// hidden / Performance mode = the full desktop-WebGPU tier, ungated. Mobile
// and desktop-WASM never leave the base sizing.
import { describe, it, expect } from 'vitest';
import { pacingPolicyFor, overrideDesktopWebgpuDispatchDepth, DESKTOP_WEBGPU_DISPATCH_DEPTH, SINGLE_FLIGHT, type PacingInputs } from './pacing-policy';
import { BASE_BATCH_SIZING, DESKTOP_WEBGPU_BATCH_SIZING, batchSizingFor, rollingBatchFor, warmupGridFor } from './batch-sizing';
import { SEQ_BUCKETS } from './iframe-runner';

const desktopGpu: PacingInputs = { isMobile: false, device: 'webgpu', performanceMode: false, focused: true, hidden: false };
const mobile: PacingInputs = { ...desktopGpu, isMobile: true };

describe('pacingPolicyFor — idle gate', () => {
    it('focused desktop, Performance mode off → gated (today\'s behaviour)', () => {
        expect(pacingPolicyFor(desktopGpu).idleGate).toBe(true);
    });
    it('unfocused desktop → ungated (nobody to stall)', () => {
        expect(pacingPolicyFor({ ...desktopGpu, focused: false }).idleGate).toBe(false);
    });
    it('hidden desktop → ungated (no compositor, issue #5)', () => {
        expect(pacingPolicyFor({ ...desktopGpu, hidden: true }).idleGate).toBe(false);
    });
    it('Performance mode on while focused → ungated (the opt-in)', () => {
        expect(pacingPolicyFor({ ...desktopGpu, performanceMode: true }).idleGate).toBe(false);
    });
    it('the gate decision is device-agnostic: unfocused desktop-WASM is ungated too', () => {
        expect(pacingPolicyFor({ ...desktopGpu, device: 'wasm', focused: false }).idleGate).toBe(false);
    });
});

describe('pacingPolicyFor — mobile is byte-identical to pre-lever-2', () => {
    it('visible mobile → gated', () => {
        expect(pacingPolicyFor(mobile).idleGate).toBe(true);
    });
    it('unfocused mobile → still gated (focus is a desktop concept)', () => {
        expect(pacingPolicyFor({ ...mobile, focused: false }).idleGate).toBe(true);
    });
    it('Performance mode is ignored on mobile → still gated', () => {
        expect(pacingPolicyFor({ ...mobile, performanceMode: true }).idleGate).toBe(true);
    });
    it('hidden mobile → ungated (the pre-existing hidden cheap-yield path)', () => {
        expect(pacingPolicyFor({ ...mobile, hidden: true }).idleGate).toBe(false);
    });
    it('mobile sizing is the base tier on every branch', () => {
        const branches = [mobile, { ...mobile, hidden: true }, { ...mobile, performanceMode: true }, { ...mobile, focused: false }];
        expect(branches.map(b => pacingPolicyFor(b).sizing)).toEqual(branches.map(() => BASE_BATCH_SIZING));
    });
});

describe('pacingPolicyFor — sizing tier follows the gate', () => {
    it('focused desktop-WebGPU → BASE_BATCH_SIZING (no stall regression vs pre-lever-1)', () => {
        expect(pacingPolicyFor(desktopGpu).sizing).toBe(BASE_BATCH_SIZING);
    });
    it('unfocused desktop-WebGPU → DESKTOP_WEBGPU_BATCH_SIZING', () => {
        expect(pacingPolicyFor({ ...desktopGpu, focused: false }).sizing).toBe(DESKTOP_WEBGPU_BATCH_SIZING);
    });
    it('hidden desktop-WebGPU → DESKTOP_WEBGPU_BATCH_SIZING', () => {
        expect(pacingPolicyFor({ ...desktopGpu, hidden: true }).sizing).toBe(DESKTOP_WEBGPU_BATCH_SIZING);
    });
    it('Performance mode desktop-WebGPU → DESKTOP_WEBGPU_BATCH_SIZING', () => {
        expect(pacingPolicyFor({ ...desktopGpu, performanceMode: true }).sizing).toBe(DESKTOP_WEBGPU_BATCH_SIZING);
    });
    it('desktop-WASM stays on the base sizing even ungated (the budget is the synchronous stall cap)', () => {
        expect(pacingPolicyFor({ ...desktopGpu, device: 'wasm', performanceMode: true }).sizing).toBe(BASE_BATCH_SIZING);
    });
});

// Tier switching must never dispatch an un-warmed shape: the embedder warms the
// LARGEST tier's grid (embedder.ts indexWarmupGrid = batchSizingFor(platform,
// 'webgpu')), so every tier the policy can pick — flush size AND every drain
// remainder below it — must sit inside that grid. Enumerates every input combo.
describe('every tier the policy can pick is inside the warmed grid', () => {
    const bools = [false, true];
    const combos: PacingInputs[] = [];
    for (const isMobile of bools) for (const performanceMode of bools) for (const focused of bools) for (const hidden of bools) {
        for (const device of ['webgpu', 'wasm'] as const) combos.push({ isMobile, device, performanceMode, focused, hidden });
    }

    it.each(combos.map(c => [JSON.stringify(c), c] as const))('%s', (_label, inputs) => {
        const warmed = new Map(warmupGridFor(batchSizingFor({ isMobile: inputs.isMobile, device: 'webgpu' }), SEQ_BUCKETS).map(c => [c.bucket, c.maxBatch]));
        const { sizing } = pacingPolicyFor(inputs);
        for (const bucket of SEQ_BUCKETS) {
            expect(warmed.get(bucket) ?? 0, `flush ${rollingBatchFor(bucket, sizing)} × seq ${bucket}`).toBeGreaterThanOrEqual(rollingBatchFor(bucket, sizing));
        }
    });
});

// Two-deep dispatch overlap (experiment nid_shw3c2udyuva92sa81oa5qxyg_e):
// only the full-speed desktop-WebGPU tier overlaps; every other branch stays
// serial (gated tier: the rIC window must find an idle GPU; mobile: memory +
// thermals; desktop-WASM: the forward is synchronous on the iframe thread).
describe('pacingPolicyFor — dispatch depth', () => {
    it('focused desktop-WebGPU (gated) → single flight', () => {
        expect(pacingPolicyFor(desktopGpu).dispatchDepth).toBe(SINGLE_FLIGHT);
    });
    it('unfocused desktop-WebGPU → DESKTOP_WEBGPU_DISPATCH_DEPTH', () => {
        expect(pacingPolicyFor({ ...desktopGpu, focused: false }).dispatchDepth).toBe(DESKTOP_WEBGPU_DISPATCH_DEPTH);
    });
    it('Performance mode desktop-WebGPU → DESKTOP_WEBGPU_DISPATCH_DEPTH', () => {
        expect(pacingPolicyFor({ ...desktopGpu, performanceMode: true }).dispatchDepth).toBe(DESKTOP_WEBGPU_DISPATCH_DEPTH);
    });
    it('unfocused desktop-WASM → single flight', () => {
        expect(pacingPolicyFor({ ...desktopGpu, device: 'wasm', focused: false }).dispatchDepth).toBe(SINGLE_FLIGHT);
    });
    it('hidden mobile (the ungated mobile branch) → single flight', () => {
        expect(pacingPolicyFor({ ...mobile, hidden: true }).dispatchDepth).toBe(SINGLE_FLIGHT);
    });
    it('the bench override swaps the desktop-WebGPU depth and null restores it', () => {
        overrideDesktopWebgpuDispatchDepth(SINGLE_FLIGHT);
        const overridden = pacingPolicyFor({ ...desktopGpu, focused: false }).dispatchDepth;
        overrideDesktopWebgpuDispatchDepth(null);
        expect({ overridden, restored: pacingPolicyFor({ ...desktopGpu, focused: false }).dispatchDepth })
            .toEqual({ overridden: SINGLE_FLIGHT, restored: DESKTOP_WEBGPU_DISPATCH_DEPTH });
    });
    it('the bench override never touches the gated tier', () => {
        overrideDesktopWebgpuDispatchDepth(3);
        const gated = pacingPolicyFor(desktopGpu).dispatchDepth;
        overrideDesktopWebgpuDispatchDepth(null);
        expect(gated).toBe(SINGLE_FLIGHT);
    });
});
