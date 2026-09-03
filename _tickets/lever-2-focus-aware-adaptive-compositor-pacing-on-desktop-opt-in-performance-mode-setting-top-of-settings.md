---
id: nid_td0kh5ezmq4tkfmhfx82d1pcr_e
title: "Lever 2: focus-aware adaptive compositor pacing on desktop + opt-in Performance mode setting (top of settings)"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_0yhtxzgrmly7zk6m6quiqfpil_e]
links: []
created_iso: 2026-09-02T22:54:56Z
status_updated_iso: 2026-09-02T22:54:56Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, lever2, ux, settings]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on lever 1 (batch sizing) so the two are measured in order. Measured on the host WebGPU bench (>= 10% rule) AND sanity-checked by the human for UI smoothness while typing during a reindex.

## Today (verified)
- `src/pacer.ts` `CompositorPacer.pace()`: after EVERY embed batch, wait for `requestIdleCallback` (timeout `IDLE_TIMEOUT_MS = 1000`); hidden document -> `cheapYield()` (scheduler.yield / setTimeout 0). Rationale in the header is macOS-Metal-specific (shared queue with WindowServer). Called from `embedOneBatch` in `src/search.ts` ~line 844; wait time accumulates into `paceWaitMs` (summary ~1526).
- No notion of window FOCUS: a visible-but-unfocused window still idle-gates.

## Policy (human-approved)
- Desktop default = ADAPTIVE: when the Obsidian window is unfocused (`activeDocument.hasFocus() === false`) or hidden -> no idle gate (cheap yield only) and the full desktop batch sizing from lever 1; when focused -> keep the rIC idle gate (UI smoothness) but still with the desktop sizing (or a "focused" sizing tier if the bench/human check shows stalls — parameterize, decide by measurement). Sizing follows lever 1's rule (bigger batches only on desktop + `webgpu`); the idle-gate decision itself is device-agnostic (skipping an rIC wait while unfocused is harmless on WASM too).
- Opt-in **Performance mode** toggle at the TOP of `src/settings-tab.ts` `display()` (~line 143), desktop-only (hidden on mobile), with a plain-language tradeoff line ("Index at full speed even while you type; the UI may stutter during a reindex"). When on -> always the unfocused behaviour.
- Mobile behaviour byte-identical to today.

## What to build
1. A `PacingPolicy` (pure, unit-testable) that maps `{ isMobile, performanceMode, focused, hidden }` -> `{ idleGate: boolean }` (+ sizing tier if introduced); `CompositorPacer` takes the policy/inputs instead of hard-coding. Focus tracking via `activeWindow` focus/blur listeners or `activeDocument.hasFocus()` polled per dispatch (cheap) — popout-window convention: `activeWindow`/`activeDocument`, never bare globals.
2. Settings: persist `performanceMode` in plugin settings (synced is fine — it is a preference, unlike the per-device backend keys), default off.
3. Forensics/log: record the policy decision counts per run (gated vs ungated dispatches) next to `paceWaitMs`.
4. Tests: policy unit tests (one assert each: mobile never ungated; perf mode ungated; unfocused ungated; focused gated; hidden ungated); pacer tests in `src/pacer.test.ts` updated, not weakened.

## Files
- `src/pacer.ts`, `src/search.ts` (~781-847), `src/settings-tab.ts`, settings type (`src/types.ts` or wherever `SeekSettings` lives), `src/main.ts` (settings load), `docs/perf-bench.md` (rows: focused/unfocused/perf-mode).

## Acceptance Criteria

PacingPolicy unit tests pass; unfocused/hidden desktop reindex shows near-zero paceWaitMs on the bench; Performance mode toggle at top of settings, desktop-only, default off; mobile unchanged; host bench rows recorded with >= 10% gain for the adopted default.


## Notes

**2026-09-03T03:30:55Z**

## Policy update from the follow-up decision (human, 2026-09-03; ticket nid_ia9lbslebos19fli7s2g3b6i8_e closed into this one)

The "focused sizing tier" is DECIDED, not open to measurement: **default = do not stall the app.**
- Focused + Performance mode off → `BASE_BATCH_SIZING` 512/8 (today's p95 dispatch ≈ 17 ms; zero stall regression vs pre-lever-1). Keep the rIC idle gate.
- Unfocused or hidden, OR Performance mode on → `DESKTOP_WEBGPU_BATCH_SIZING` 2048/32 (sweep: −17.5 % wall-clock, p95 dispatch 56 ms) and no idle gate (cheap yield only).
- Mobile and desktop-WASM: byte-identical to today (512/8 on every tier; the sizing rule stays "bigger only on desktop + webgpu").
- So `PacingPolicy` maps `{ isMobile, device, performanceMode, focused, hidden }` → `{ idleGate, sizing }`; `batchSizingFor` grows the focus/perf inputs (or the policy wraps it) — still ONE resolver.
- No re-warm on tier switch: per bucket the 2048/32 grid ⊇ the 512/8 grid (`src/batch-sizing.test.ts` pins base ⊆ desktop). The embedder keeps warming the LARGEST tier's grid on desktop-WebGPU (as today); the tier only changes the flush size. Add a test that every tier's flush sizes and remainders are inside the warmed grid.
- Sizing may be re-resolved per pass or per dispatch (lever 1 resolves once per pass; switching mid-pass on a focus change is allowed because both shapes are warmed — decide by simplicity).
- No user-facing batch-size setting and no debug budget/max override (decided). Reopen trigger for a lower unfocused tier: field report of hitches on a weaker GPU class.
- Bench rows to record in docs/perf-bench.md: focused (512/8, gated), unfocused (2048/32, ungated), perf-mode (same as unfocused). The bench's "unfocused" run is the headline; the focused row should match the 512/8 reference (3492 ms at 70 files).
