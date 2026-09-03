// CompositorPacer — HOW it waits for each idleGate decision (lever 2 moved the
// WHETHER into pacing-policy.ts; see pacing-policy.test.ts for hidden / focus /
// Performance-mode). The ungated path matters most: a hidden window's rIC only
// ever fires via its timeout guard — in the field that stretched a hidden
// commit's ~1.5 s of embed compute to 92.8 s wall (~3 s per batch at 1 Hz
// wakeups) — so an ungated pace must never touch rIC at all.
//
// windowStateNow() is the live-input reader the orchestrator feeds the policy;
// its activeDocument / override behaviour is pinned in the second describe.

import { describe, it, expect, afterEach } from 'vitest';
import { CompositorPacer, windowStateNow, overrideWindowFocus } from './pacer';

type G = { activeDocument?: { hidden: boolean; hasFocus: () => boolean }; requestIdleCallback?: unknown };
const g = globalThis as unknown as G;

afterEach(() => {
    delete g.activeDocument;
    delete g.requestIdleCallback;
    overrideWindowFocus(null);
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

describe('CompositorPacer.pace(idleGate)', () => {
    it('gated: defers to requestIdleCallback (compositor arbitration)', async () => {
        const ric = installFiringRic(10);
        await new CompositorPacer().pace(true);
        expect(ric.calls()).toBe(1);
    });

    it('ungated: never touches rIC — resolves via the cheap yield', async () => {
        let ricCalls = 0;
        // An rIC that NEVER fires its callback models the hidden renderer
        // (no frames → no natural idle windows). If the pacer consulted it,
        // this pace() would hang until the test times out.
        g.requestIdleCallback = (): number => { ricCalls++; return 1; };
        await new CompositorPacer().pace(false);
        expect(ricCalls).toBe(0);
    });

    it('a still-fresh idle slice is shared across consecutive gated paces (fast path)', async () => {
        const ric = installFiringRic(40);
        const p = new CompositorPacer();
        await p.pace(true);
        await p.pace(true);   // budget left in the granted slice → no second rIC
        expect(ric.calls()).toBe(1);
    });

    it('an ungated pace drops the granted slice, so the next gated pace re-yields to rIC', async () => {
        const ric = installFiringRic(40);
        const p = new CompositorPacer();
        await p.pace(true);
        await p.pace(false);  // e.g. the window lost focus for one dispatch
        await p.pace(true);   // a stale deadline must not let this skip the gate
        expect(ric.calls()).toBe(2);
    });
});

describe('windowStateNow — the live policy inputs', () => {
    it('no activeDocument global (tests / exotic hosts): reports focused + visible (→ the gated path)', () => {
        expect(windowStateNow()).toEqual({ focused: true, hidden: false });
    });

    it('reads focus from activeDocument.hasFocus()', () => {
        g.activeDocument = { hidden: false, hasFocus: () => false };
        expect(windowStateNow().focused).toBe(false);
    });

    it('reads hidden from activeDocument.hidden', () => {
        g.activeDocument = { hidden: true, hasFocus: () => true };
        expect(windowStateNow().hidden).toBe(true);
    });

    it('overrideWindowFocus pins the focus signal regardless of activeDocument (bench knob)', () => {
        g.activeDocument = { hidden: false, hasFocus: () => true };
        overrideWindowFocus(false);
        expect(windowStateNow().focused).toBe(false);
    });

    it('overrideWindowFocus(null) clears the pin', () => {
        g.activeDocument = { hidden: false, hasFocus: () => true };
        overrideWindowFocus(false);
        overrideWindowFocus(null);
        expect(windowStateNow().focused).toBe(true);
    });
});
