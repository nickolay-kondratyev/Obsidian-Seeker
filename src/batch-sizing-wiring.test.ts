// Lever 1 (nid_0yhtxzgrmly7zk6m6quiqfpil_e) — the orchestrator's use of
// batchSizingFor. The unit tests in batch-sizing.test.ts pin the sizing
// function; these pin that the indexer actually flushes with it, on the device
// the embedder reports AT DISPATCH TIME — not the one it had when the pass
// began. A mid-pass recycle (GPU crash / SafeInt overflow) can land the session
// on WASM, where a dispatch runs synchronously on the iframe thread and the
// base budget IS the main-thread stall cap; keeping the desktop-WebGPU sizing
// there would quadruple every remaining stall.
import { describe, it, expect, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { Scenario } from './test-harness/scenario';
import { BASE_BATCH_SIZING, DESKTOP_WEBGPU_BATCH_SIZING } from './batch-sizing';
import type { Device } from './types';

// Identical short notes → every chunk lands in the smallest seq bucket, where
// the flush size is exactly maxBatch (32 on desktop WebGPU, 8 on base).
function writeShortNotes(s: Scenario, n: number): void {
    for (let i = 0; i < n; i++) s.vault.write(`n${i}.md`, `short note ${i} about tea`, 1000);
}

type FakeEmbedder = { device: Device; embedBatch: (texts: string[], ...rest: unknown[]) => Promise<unknown>; recycle: () => Promise<void> };

// Since lever 2 the desktop-WebGPU sizing is only in force when the window is
// UNFOCUSED (or hidden / Performance mode) — a focused window keeps the base
// tier by policy (pacing-policy.ts). These tests are about the DEVICE axis, so
// they pin the window unfocused; the focus axis is covered in pacing-wiring.test.ts.
type G = { activeDocument?: { hidden: boolean; hasFocus: () => boolean } };
const g = globalThis as unknown as G;

describe('SearchOrchestrator flushes with batchSizingFor(platform, embedder.device)', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; Platform.isMobile = false; delete g.activeDocument; });

    async function bootDesktop(device: Device): Promise<{ s: Scenario; e: FakeEmbedder }> {
        Platform.isMobile = false;
        g.activeDocument = { hidden: false, hasFocus: () => false };
        const s = new Scenario();
        await s.boot();
        active = s;
        const e = s.embedder as unknown as FakeEmbedder;
        e.device = device;
        return { s, e };
    }

    it('desktop + webgpu flushes the smallest bucket at DESKTOP_WEBGPU_BATCH_SIZING.maxBatch', async () => {
        const { s, e } = await bootDesktop('webgpu');
        writeShortNotes(s, DESKTOP_WEBGPU_BATCH_SIZING.maxBatch + 1);
        const sizes: number[] = [];
        const real = e.embedBatch.bind(e);
        e.embedBatch = async (texts, ...rest) => { sizes.push(texts.length); return real(texts, ...rest); };

        await s.orch.reindexAll();

        expect(Math.max(...sizes)).toBe(DESKTOP_WEBGPU_BATCH_SIZING.maxBatch);
    });

    it('desktop + wasm keeps the base flush size', async () => {
        const { s, e } = await bootDesktop('wasm');
        writeShortNotes(s, DESKTOP_WEBGPU_BATCH_SIZING.maxBatch + 1);
        const sizes: number[] = [];
        const real = e.embedBatch.bind(e);
        e.embedBatch = async (texts, ...rest) => { sizes.push(texts.length); return real(texts, ...rest); };

        await s.orch.reindexAll();

        expect(Math.max(...sizes)).toBe(BASE_BATCH_SIZING.maxBatch);
    });

    it('GIVEN a mid-pass recycle lands on wasm THEN every later flush uses the base sizing', async () => {
        const { s, e } = await bootDesktop('webgpu');
        writeShortNotes(s, DESKTOP_WEBGPU_BATCH_SIZING.maxBatch * 3);
        const real = e.embedBatch.bind(e);
        let failed = false;
        let recycled = false;
        let retried = false;
        const afterRecycle: number[] = [];
        e.embedBatch = async (texts, ...rest) => {
            if (!failed) { failed = true; throw new Error('simulated device loss'); }
            // The retry re-dispatches the failed batch's inputs by design; only
            // flushes assembled AFTER the recycle are under test.
            if (recycled && !retried) retried = true;
            else if (recycled) afterRecycle.push(texts.length);
            return real(texts, ...rest);
        };
        e.recycle = async () => { e.device = 'wasm'; recycled = true; };

        await s.orch.reindexAll();

        expect(recycled).toBe(true);
        expect(afterRecycle.length).toBeGreaterThan(0);
        expect(Math.max(...afterRecycle)).toBeLessThanOrEqual(BASE_BATCH_SIZING.maxBatch);
    });
});
