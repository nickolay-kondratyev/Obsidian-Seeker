// Lever 2 (nid_td0kh5ezmq4tkfmhfx82d1pcr_e) — the orchestrator's use of
// pacing-policy.ts. The unit tests pin the policy; these pin that a reindex
// actually FOLLOWS it: the gate the pacer takes, the flush size, and the
// gated/ungated split on the completion entry, each read from the live inputs
// (window focus, Performance mode, platform) at dispatch time.
import { describe, it, expect, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { Scenario } from './test-harness/scenario';
import { BASE_BATCH_SIZING, DESKTOP_WEBGPU_BATCH_SIZING } from './batch-sizing';
import type { IndexCompleteEntry } from './types';

type G = { activeDocument?: { hidden: boolean; hasFocus: () => boolean }; requestIdleCallback?: unknown };
const g = globalThis as unknown as G;

// Identical short notes → every chunk lands in the smallest seq bucket, where
// the flush size is exactly maxBatch (32 on the desktop-WebGPU tier, 8 on base).
function writeShortNotes(s: Scenario, n: number): void {
    for (let i = 0; i < n; i++) s.vault.write(`n${i}.md`, `short note ${i} about tea`, 1000);
}

type FakeEmbedder = { device: 'webgpu' | 'wasm'; embedBatch: (texts: string[], ...rest: unknown[]) => Promise<unknown> };

interface Run { entry: IndexCompleteEntry; maxFlush: number; ricCalls: number }

describe('SearchOrchestrator follows pacingPolicyFor at dispatch time', () => {
    let active: Scenario | null = null;
    afterEach(async () => {
        await active?.teardown(); active = null;
        Platform.isMobile = false;
        delete g.activeDocument;
        delete g.requestIdleCallback;
    });

    async function reindex(opts: { mobile: boolean; focused: boolean; hidden?: boolean; performanceMode?: boolean }): Promise<Run> {
        Platform.isMobile = opts.mobile;
        g.activeDocument = { hidden: opts.hidden ?? false, hasFocus: () => opts.focused };
        // An rIC that fires at once with no budget left, so every gated pace
        // pays exactly one rIC call — the count IS the number of gated dispatches.
        let ricCalls = 0;
        g.requestIdleCallback = (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void): number => {
            ricCalls++;
            cb({ timeRemaining: () => 0, didTimeout: false });
            return 1;
        };
        const s = new Scenario();
        await s.boot();
        active = s;
        const e = s.embedder as unknown as FakeEmbedder;
        e.device = 'webgpu';
        (s.orch as unknown as { settings: { performanceMode: boolean } }).settings.performanceMode = opts.performanceMode ?? false;
        writeShortNotes(s, DESKTOP_WEBGPU_BATCH_SIZING.maxBatch + 1);
        const sizes: number[] = [];
        const real = e.embedBatch.bind(e);
        e.embedBatch = async (texts, ...rest) => { sizes.push(texts.length); return real(texts, ...rest); };

        const entry = await s.orch.reindexAll();
        return { entry, maxFlush: Math.max(...sizes), ricCalls };
    }

    describe('focused desktop, Performance mode off (the default)', () => {
        it('flushes at the base tier', async () => {
            expect((await reindex({ mobile: false, focused: true })).maxFlush).toBe(BASE_BATCH_SIZING.maxBatch);
        });
        it('idle-gates every dispatch', async () => {
            const run = await reindex({ mobile: false, focused: true });
            expect(run.ricCalls).toBe(run.entry.paceGatedDispatches);
        });
        it('records every dispatch as gated', async () => {
            const { entry } = await reindex({ mobile: false, focused: true });
            expect({ ungated: entry.paceUngatedDispatches, gatedIsAll: entry.paceGatedDispatches === entry.embedBatchLatencyMs?.n })
                .toEqual({ ungated: 0, gatedIsAll: true });
        });
    });

    describe('unfocused desktop', () => {
        it('flushes at the desktop-WebGPU tier', async () => {
            expect((await reindex({ mobile: false, focused: false })).maxFlush).toBe(DESKTOP_WEBGPU_BATCH_SIZING.maxBatch);
        });
        it('never touches requestIdleCallback', async () => {
            expect((await reindex({ mobile: false, focused: false })).ricCalls).toBe(0);
        });
        it('records every dispatch as ungated', async () => {
            const { entry } = await reindex({ mobile: false, focused: false });
            expect({ gated: entry.paceGatedDispatches, ungatedIsAll: entry.paceUngatedDispatches === entry.embedBatchLatencyMs?.n })
                .toEqual({ gated: 0, ungatedIsAll: true });
        });
    });

    describe('focused desktop, Performance mode on', () => {
        it('flushes at the desktop-WebGPU tier', async () => {
            expect((await reindex({ mobile: false, focused: true, performanceMode: true })).maxFlush).toBe(DESKTOP_WEBGPU_BATCH_SIZING.maxBatch);
        });
        it('never touches requestIdleCallback', async () => {
            expect((await reindex({ mobile: false, focused: true, performanceMode: true })).ricCalls).toBe(0);
        });
    });

    describe('hidden desktop', () => {
        it('never touches requestIdleCallback (the pre-existing hidden path)', async () => {
            expect((await reindex({ mobile: false, focused: false, hidden: true })).ricCalls).toBe(0);
        });
    });

    describe('mobile is byte-identical to pre-lever-2', () => {
        it('unfocused + Performance mode on still flushes at the base tier', async () => {
            expect((await reindex({ mobile: true, focused: false, performanceMode: true })).maxFlush).toBe(BASE_BATCH_SIZING.maxBatch);
        });
        it('unfocused + Performance mode on still idle-gates every dispatch', async () => {
            const run = await reindex({ mobile: true, focused: false, performanceMode: true });
            expect(run.ricCalls).toBe(run.entry.paceGatedDispatches);
        });
    });
});
