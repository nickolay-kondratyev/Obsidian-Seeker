---
closed_iso: 2026-09-03T04:48:40Z
session_ids: [{"a": "claude", "type": "execution", "id": "aee23b8f-d762-41d2-9b6b-95e72eb9e83d"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_td0kh5ezmq4tkfmhfx82d1pcr_e
title: "Lever 2: focus-aware adaptive compositor pacing on desktop + opt-in Performance mode setting (top of settings)"
status: closed
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_0yhtxzgrmly7zk6m6quiqfpil_e]
links: [nid_wzsj2sawjazdxakqi8czjh0sc_e, nid_0yhtxzgrmly7zk6m6quiqfpil_e, nid_ia9lbslebos19fli7s2g3b6i8_e, nid_9onhu2309zfy32w37xtmz8a0p_e, nid_mw6gkmuurjhiqva4rr6doenul_e]
created_iso: 2026-09-02T22:54:56Z
status_updated_iso: 2026-09-03T04:48:40Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, lever2, ux, settings, need-human]
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

## Resolution (agent, 2026-09-03) — code complete, HOST BENCH ROWS + UI smoothness check still need the human

Commit `1d3add2` on this branch. Everything below is implemented, typechecked, and covered by tests (`npm run test`: 77 files / 1370 tests green; `npm run typecheck` clean; `npm run build` clean).

### What was built and where
- `src/pacing-policy.ts` — pure `pacingPolicyFor({ isMobile, device, performanceMode, focused, hidden }) → { idleGate, sizing }`. Rules exactly as decided above: hidden → ungated on every platform (pre-existing issue #5 path, mobile included); mobile visible → always gated + base sizing (focus and Performance mode ignored); desktop unfocused or Performance mode → ungated + `batchSizingFor(platform, device)` (= 2048/32 on WebGPU, 512/8 on WASM); desktop focused → gated + `BASE_BATCH_SIZING`. `batchSizingFor` stays the ONE resolver for the largest tier a (platform, device) can flush with; the policy only picks between base and that.
- `src/pacer.ts` — `CompositorPacer.pace(idleGate: boolean)`: the pacer only knows HOW to wait; the hidden check moved out into the policy. An ungated pace drops the granted rIC slice so a later gated pace cannot skip the gate on a stale deadline. New `windowStateNow()` (polls `activeDocument.hasFocus()` / `.hidden` per dispatch — cheap; no listener lifecycle, popout-safe) and bench-only `overrideWindowFocus()` (mirrors `overrideDesktopWebgpuSizing`).
- `src/search.ts` — `SearchOrchestrator.pacingDecision()` (public) resolves the policy from live inputs; the reindex engine calls it at every flush decision and every dispatch (the tier may switch mid-pass on a focus change, both shapes are warmed). `IndexCompleteEntry.paceGatedDispatches` / `paceUngatedDispatches` recorded next to `paceWaitMs`; the `ℹ️ embed:` check line shows the split.
- `src/main.ts` — the catch-up drain paces through the same `pacingDecision()` (the only other `CompositorPacer` user).
- Settings: `SeekSettings.performanceMode` (default `false`, synced, no migration needed — `Object.assign` backfills). `src/settings-tab.ts` `renderPerformanceMode` is the FIRST row of `display()`, hidden on mobile, copy: "Index at full speed even while you type; the UI may stutter during a reindex. Off: indexing yields to you while this window is focused and runs at full speed when it is not."
- Tests: `src/pacing-policy.test.ts` (one assert each: gate rules, mobile byte-identical, sizing per tier, and the every-tier-inside-the-warmed-grid invariant over all 32 input combos); `src/pacer.test.ts` rewritten around `pace(idleGate)` + `windowStateNow`; `src/pacing-wiring.test.ts` (Scenario harness: flush size, rIC call count, gated/ungated counts per tier, mobile unchanged); `src/batch-sizing-wiring.test.ts` now pins the window unfocused (it tests the device axis).
- Bench: `BENCH_PACING=focused|unfocused|perf-mode` (default `unfocused`) on `bench/harness/run.mjs` / `page.ts`; the page PINS the focus signal (headless `hasFocus()` is a driver detail). `scripts/bench-sweep.mjs` forces `unfocused`. Result rows carry `pacing`, `paceGatedDispatches`, `paceUngatedDispatches`; `SUMMARY_METRICS` medians the two counts. `docs/perf-bench.md` §Lever 2 has the tier table, the three host commands, and a pending row table.
- Docs: README "Performance mode (desktop)" paragraph; `src/CLAUDE.md` layer line.

### Assumptions made (no human available)
- "Mobile never ungated" in the ticket's test list was read as "focus / Performance mode never ungate mobile"; hidden mobile keeps today's cheap-yield path (byte-identical requirement wins).
- Toggle placed ABOVE the "Running on:" backend line (the ticket says TOP of `display()`).
- Sizing is re-resolved per dispatch (simplest; lever 1 already re-resolved per flush for the recycle case).
- Catch-up drain (`main.ts`) follows the same policy — it was the only other pacer user and a diverging rule there would have been a surprise.

### Remaining — human on the host (container has no GPU)
1. Run the three rows in `docs/perf-bench.md` §Lever 2 (`BENCH_PACING=focused|unfocused|perf-mode`, `BENCH_DEVICE=webgpu BENCH_FILES=70`) and fill the pending table. Expect: focused ≈ 3492 ms, dispatches ≈ 156, `paceUngatedDispatches` 0; unfocused ≤ 2882 ms, dispatches ≈ 40, `paceGatedDispatches` 0; perf-mode = unfocused within noise. The ≥ 10 % rule is unfocused vs focused.
2. Type in a note during a full reindex in real Obsidian with Performance mode off (should feel like pre-lever-1) and on (may stutter). Reopen trigger for a lower unfocused tier: hitches on a weaker GPU.
3. Then close this ticket.

**2026-09-03T03:47:35Z**

Container WASM regression bench (commit 1d3add2, npm run bench, BENCH_PACING default unfocused, 12 files): wallClock median 16684 ms (spread 0.5 %), embedDispatches 28, effectiveBatch 2.39, paddedTokens 10766 — identical to the baseline row (desktop-WASM sizing is unchanged by design). New counters: paceGatedDispatches 0 / paceUngatedDispatches 28 as expected for the unfocused tier. Host WebGPU rows (focused / unfocused / perf-mode) remain for the human — see Resolution section.

**2026-09-03T04:44:41Z**

Merged branch nid_td0kh5ezmq4tkfmhfx82d1pcr_e_lever-2-focus-aware-adaptive-compositor into main (merge 7c99176, no conflicts). Post-merge on main: typecheck clean, 77 test files / 1370 tests green, build clean. Logic review of pacing-policy.ts, pacer.ts, search.ts wiring, main.ts catch-up drain, settings type+tab, tests, and the bench harness found the implementation consistent with the decided policy (focused → gated 512/8; unfocused/hidden/perf-mode → ungated batchSizingFor tier; mobile + desktop-WASM byte-identical; warmup grid still = largest tier; drain loop flushes in slices so a mid-pass shrink strands nothing). One fix applied: bench/harness/page.ts probe now derives its self-describing batchSizing from the PINNED windowStateNow() instead of the live document.hidden, so a row cannot describe a tier the run did not use. Still open for the human host bench rows (docs/perf-bench.md §Lever 2 pending table) + UI smoothness check.

**2026-09-03T04:48:39Z**

Host bench rows recorded (2026-09-03, commit 7abac9c, Radeon 8060S, 70 files) in docs/perf-bench.md §Lever 2: focused 3462.5 ms / 156 dispatches / 156 gated 0 ungated / p95 16.7 ms (matches 512/8 reference); unfocused 2870 ms / 40 dispatches / 0 gated 40 ungated / p95 56.6 ms = −17.1 % vs focused (>= 10 % rule PASS); perf-mode 2875.4 ms = unfocused within noise. Zero recycles. All acceptance criteria met → closing. NOT reported: the by-hand UI smoothness check (type during a reindex with Performance mode off/on); reopen if hitches show up on a weaker GPU.
