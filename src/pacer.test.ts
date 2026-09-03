// CompositorPacer — HOW it waits between embed dispatches, and the one
// WHETHER it decides itself: a hidden window (issue #5). A hidden renderer's
// rIC only ever fires via its timeout guard — in the field that stretched a
// hidden commit's ~1.5 s of embed compute to 92.8 s wall (~3 s per batch at
// 1 Hz wakeups) — so a hidden pace must never touch rIC at all.

import { describe, it, expect, afterEach } from 'vitest';
import { CompositorPacer } from './pacer';

type G = { activeDocument?: { hidden: boolean }; requestIdleCallback?: unknown };
const g = globalThis as unknown as G;

afterEach(() => {
    delete g.activeDocument;
    delete g.requestIdleCallback;
});

// An rIC that fires immediately with `remaining` ms of idle budget.
function installFiringRic(remaining: number): { calls: () => number } {
    let calls = 0;
    g.requestIdleCallback = (cb: (d: { timeRemaining: () => number; didTimeout: boolean }) => void): number => {
        calls++;
        cb({ timeRemaining: () => remaining, didTimeout: false });
        return 1;
    };
    return { calls: () => calls };
}

describe('CompositorPacer.pace()', () => {
    it('visible window: defers to requestIdleCallback (compositor arbitration)', async () => {
        g.activeDocument = { hidden: false };
        const ric = installFiringRic(10);
        await new CompositorPacer().pace();
        expect(ric.calls()).toBe(1);
    });

    it('no activeDocument global (tests / exotic hosts): the rIC chain', async () => {
        const ric = installFiringRic(10);
        await new CompositorPacer().pace();
        expect(ric.calls()).toBe(1);
    });

    it('hidden window: never touches rIC — resolves via the cheap yield', async () => {
        g.activeDocument = { hidden: true };
        let ricCalls = 0;
        // An rIC that NEVER fires its callback models the hidden renderer
        // (no frames → no natural idle windows). If the pacer consulted it,
        // this pace() would hang until the test times out.
        g.requestIdleCallback = (): number => { ricCalls++; return 1; };
        await new CompositorPacer().pace();
        expect(ricCalls).toBe(0);
    });

    it('a still-fresh idle slice is shared across consecutive paces (fast path)', async () => {
        g.activeDocument = { hidden: false };
        const ric = installFiringRic(40);
        const p = new CompositorPacer();
        await p.pace();
        await p.pace();   // budget left in the granted slice → no second rIC
        expect(ric.calls()).toBe(1);
    });
});
