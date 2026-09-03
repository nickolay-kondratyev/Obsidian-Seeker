// CompositorPacer — meters GPU embed dispatches against compositor pressure
// during a full reindex. Implements "Seek System Bog-Down Diagnosis.md"
// §Next Steps PR #1.
//
// Problem: WebGPU dispatches share one Metal queue with Obsidian's window
// compositing. At the ~97% GPU residency a reindex sustains, the compositor
// (WindowServer) is starved into ~3% windows and bursts to catch up — the UI
// jank / fan ramp the diagnosis measured (WindowServer P95 36.7%). The
// platform exposes ZERO GPU-priority knobs to web code: no QoS hint on
// submit(), powerPreference is a no-op on single-GPU Apple Silicon, and
// Metal's priority APIs aren't bridged through WebGPU. So the only lever is
// *when* we enqueue work, not how hard the GPU runs once a dispatch is in
// flight — queue arbitration, not GPU throttling.
//
// requestIdleCallback is the one platform primitive *defined by* the absence
// of compositor pressure: it fires only when the renderer reports no pending
// frame work. Yielding through it gives automatic backpressure for free — if
// the user scrolls/types the next idle callback simply doesn't fire until the
// compositor goes quiet, with zero hand-tuning. (requestAnimationFrame is the
// structural opposite — it fires right before the compositor needs the GPU, so
// enqueuing a dispatch after rAF lands our work directly in the frame slot.)
//
// Fallback chain (best → worst):
//   requestIdleCallback  — desktop Electron/Chromium; backpressure-aware
//   scheduler.yield()    — continuation-preserving yield where rIC is absent
//   setTimeout(0)        — iOS WKWebView; macrotask yield, lets compositor paint
//
// iOS has neither rIC nor scheduler.yield, so the chain degrades to the exact
// pre-PR#1 behavior (setTimeout(0)); iOS Jetsam backpressure is unaffected.
//
// WHETHER to idle-gate a given dispatch is not decided here: pacing-policy.ts
// maps (mobile, device, Performance mode, window focus, hidden) to that, and
// search.ts hands the decision to pace() per dispatch. The pacer only knows
// HOW to wait. (Lever 2, ticket nid_td0kh5ezmq4tkfmhfx82d1pcr_e — before it,
// the hidden check lived here.)

// Timeout guard (ms): after this long without a natural idle window, rIC fires
// anyway, so sustained heavy interaction can't starve the reindex forever.
const IDLE_TIMEOUT_MS = 1000;

// scheduler.yield() is too new for the DOM lib's Scheduler type, so probe it
// behind a minimal structural type rather than widening to `any`.
type YieldScheduler = { yield: () => Promise<void> };
function schedulerYield(): Promise<void> | null {
    const s = (activeWindow as { scheduler?: Partial<YieldScheduler> }).scheduler;
    return typeof s?.yield === 'function' ? s.yield() : null;
}

// Cheap thread-yield for LATENCY-SENSITIVE paths (the cold-search BM25 fit):
// gives the compositor/input a turn WITHOUT waiting for a full idle window.
// CompositorPacer's rIC wait is correct for background work (reindex, catch-up,
// compaction) where deferring to the user is the point — but on a path the
// user is actively waiting on, an rIC could stall up to IDLE_TIMEOUT_MS per
// yield under load. scheduler.yield() is continuation-preserving (our resume
// runs ahead of other queued tasks); setTimeout(0) is the universal fallback
// (~1-4 ms). Both bound the added latency to milliseconds per call.
export function cheapYield(): Promise<void> {
    const yielded = schedulerYield();
    if (yielded) return yielded;
    return new Promise<void>(resolve => window.setTimeout(() => resolve(), 0));
}

// ── window state: the live inputs pacing-policy.ts needs ─────────────────────

export interface WindowState {
    // activeDocument.hasFocus(): keyboard focus is in the Obsidian window. The
    // signal is polled per dispatch (a hasFocus() call is trivially cheap) rather
    // than tracked through focus/blur listeners — no listener lifecycle, and a
    // popout window (activeDocument follows it) needs no re-subscription.
    readonly focused: boolean;
    // activeDocument.hidden: minimised / on another virtual desktop / a hidden
    // tab — no compositor to defer to (issue #5).
    readonly hidden: boolean;
}

// Without an activeDocument (tests, exotic hosts) report focused + visible,
// which the policy resolves to the conservative gated path — exactly the
// pre-lever-2 behaviour of "no activeDocument → the rIC chain".
export function windowStateNow(): WindowState {
    if (windowFocusOverride !== null) return { focused: windowFocusOverride, hidden: false };
    if (typeof activeDocument === 'undefined') return { focused: true, hidden: false };
    return { focused: activeDocument.hasFocus(), hidden: activeDocument.hidden };
}

// Bench-only knob (`BENCH_PACING`, bench/harness/page.ts): pins the focus
// signal for this process so a headless page — whose hasFocus() answer is an
// implementation detail of the browser driver, not something a bench row
// should depend on — measures the focused and the unfocused tier on purpose.
// Never called by production code; `null` clears.
let windowFocusOverride: boolean | null = null;
export function overrideWindowFocus(focused: boolean | null): void {
    windowFocusOverride = focused;
}

export class CompositorPacer {
    // Idle deadline granted by the most recent rIC callback, else null (never
    // run, or not on the rIC path). timeRemaining() decays toward 0 as the
    // granted idle window elapses; the platform clamps its ceiling to ~50 ms.
    private deadline: IdleDeadline | null = null;

    // Call once per GPU work unit (one embed batch) with the policy's idleGate
    // decision for it. Gated: resolves when it's OK to dispatch the next unit —
    // immediately if the current idle slice still has budget, otherwise after
    // the next idle slice (or the timer fallback). Ungated: the cheap
    // continuation yield only, so the thread still gets a turn each batch.
    async pace(idleGate: boolean): Promise<void> {
        if (!idleGate) {
            // A hidden window's rIC never fires naturally (no frames → no idle
            // windows), so every gated pace would stall on the IDLE_TIMEOUT_MS
            // guard (measured in the field: a 56-chunk hidden commit's ~1.5 s of
            // embed compute stretched to 92.8 s wall at ~3 s per batch). The
            // cheap yield keeps the run at full speed while still yielding the
            // thread each batch — and scheduler.yield continuations are exempt
            // from hidden-tab timer throttling, unlike the setTimeout fallback
            // rIC degrades to. An unfocused-but-visible window takes the same
            // path by policy: its compositor serves another app's frames.
            this.deadline = null;
            await cheapYield();
            return;
        }
        // Still inside a granted idle window with budget to spare — the last
        // embed was fast enough that consecutive small files (p50=1 chunk)
        // can share one slice. Proceed without re-yielding. The ≤50 ms slice
        // cap is enforced by the platform, not us.
        if (this.deadline && this.deadline.timeRemaining() > 0) return;
        this.deadline = await this.nextSlice();
    }

    // Resolve at the next moment the compositor is quiet, returning the idle
    // deadline when available so pace() can meter the slice's remaining budget.
    private nextSlice(): Promise<IdleDeadline | null> {
        if (typeof requestIdleCallback === 'function') {
            return new Promise<IdleDeadline | null>(resolve =>
                requestIdleCallback(deadline => resolve(deadline), { timeout: IDLE_TIMEOUT_MS }),
            );
        }
        const yielded = schedulerYield();
        if (yielded) return yielded.then(() => null);
        return new Promise<IdleDeadline | null>(resolve => window.setTimeout(() => resolve(null), 0));
    }
}
