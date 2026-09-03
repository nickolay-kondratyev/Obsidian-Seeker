---
id: nid_wzsj2sawjazdxakqi8czjh0sc_e
title: "Revert indexing levers 1+2 (batch-sizing tiers, focus-aware pacing, Performance mode) to ONE base tier; keep rolling buffer + lever 0 CPU warning"
status: open
deps: []
links: [nid_0yhtxzgrmly7zk6m6quiqfpil_e, nid_td0kh5ezmq4tkfmhfx82d1pcr_e, nid_ia9lbslebos19fli7s2g3b6i8_e, nid_9onhu2309zfy32w37xtmz8a0p_e, nid_mw6gkmuurjhiqva4rr6doenul_e]
created_iso: 2026-09-03T17:09:21Z
status_updated_iso: 2026-09-03T17:09:21Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, simplify, robustness, desktop, webgpu]
---

DECISION (human, 2026-09-03): the lever 1 + lever 2 indexing speedup is an UNFOCUSED-ONLY ~17.5% wall-clock win that is not make-or-break. We are reverting BOTH to slash complexity and favour robustness. Analysis that led here is recorded in the ticket notes below.

WHY THEY REVERT TOGETHER: `src/pacing-policy.ts` only hands out the 2048/32 desktop-WebGPU tier (lever 1) on its `fullSpeed()` path, which is only reached when the window is unfocused / hidden / Performance mode. A FOCUSED desktop window already runs the pre-lever path byte-for-byte (BASE 512/8 + rIC idle gate). So the speedup and the focus-aware machinery are the same feature: you cannot keep one and drop the other.

WHAT STAYS — DO NOT TOUCH:
1. The per-bucket ROLLING BUFFER in `src/search.ts` (header comment "Indexing batches via PER-BUCKET ROLLING BUFFERS (2026-06-03 redesign)", `buffers` Map, `flushBucket`, `resolveChunk`, drain loop). It is the real, always-on win (45%→85% padding efficiency) and predates the levers.
2. LEVER 0 — the CPU-not-real-WebGPU warning. Already shipped and exactly what the human wants kept: `warnIfIndexingOnCpu` in `src/main.ts` (fires at reindex start, called from `reindexAll` path), decision + copy in `src/backend-warning.ts` (`shouldWarn`, `describeWasmReason` — already reports a software SwiftShader/llvmpipe adapter as the reason), adapter classification in `src/platform.ts` (`getResolvedBackend`). Add a pinned test if one does not already assert the pop-up fires at reindex start on wasm fallback — verify with `grep -n warnIfIndexingOnCpu src/*.test.ts` first.
3. The pacer HIDDEN rule (issue #5, predates lever 2): a hidden window's rIC never fires, so a gated pace stalls on IDLE_TIMEOUT_MS (measured 92.8 s field stall). Pre-lever-2 this check lived INSIDE `src/pacer.ts` (`activeDocument.hidden` → `cheapYield()`); lever 2 moved it out to pacing-policy. Move it BACK into the pacer. See commit 1d3add2 diff of `src/pacer.ts` for the exact pre-lever shape.

WHAT GOES (lever 1 = commits 66a62bd, ebb7acb, a919a80, e88b630; lever 2 = 1d3add2, 7abac9c):
- `src/pacing-policy.ts` + `src/pacing-policy.test.ts` + `src/pacing-wiring.test.ts`: delete. `SearchOrchestrator.pacingDecision()` in `src/search.ts` and `decisionNow()` in `embedAndCommitFiles` go with them; `flushBucket` uses one fixed sizing; `pacer.pace()` loses its `idleGate` parameter.
- `src/pacer.ts`: remove `WindowState`, `windowStateNow`, `overrideWindowFocus`; `pace()` decides hidden internally again. Keep `cheapYield` (used by the BM25 fit path) and the rIC/scheduler.yield/setTimeout fallback chain unchanged.
- `src/batch-sizing.ts`: collapse to ONE sizing. Delete `DESKTOP_WEBGPU_BATCH_SIZING`, `batchSizingFor`, `BatchSizingContext`, `overrideDesktopWebgpuSizing`. KEEP `BatchSizing` type, one `BATCH_SIZING = {512, 8}` constant, `rollingBatchFor`, and the derived `warmupGridFor` / `warmupGridKey` / `warmupPassCount` — deriving the warmup grid from the sizing is a good DRY property that is cheap to keep and stops the un-warmed-shape bug class. Trim `src/batch-sizing.test.ts`; delete `src/batch-sizing-wiring.test.ts` (or reduce it to "search.ts and embedder.ts read the same constant").
- `src/embedder.ts` `indexWarmupGrid()`: no longer takes platform/device — one grid. The `warmupFingerprint` key changes value (fewer shapes) → one-time re-warm for users, acceptable; note it in the changelog.
- `src/iframe-runner.ts`: only comments reference the tiers; update them. The `warmupGrid` payload plumbing stays.
- `src/types.ts`: drop `SeekerSettings.performanceMode` + its default + the `paceGatedDispatches` / `paceUngatedDispatches` index-complete fields (search.ts counters too). Verify settings load merges defaults over persisted data (Object.assign-style) so an old data.json with a stray `performanceMode` key is harmless — if NOT, add a one-line strip on load.
- `src/settings-tab.ts`: remove the Performance mode toggle (top of tab, `nid_td0kh5ezmq4tkfmhfx82d1pcr_e`).
- `src/platform.ts`: check for lever-only helpers referenced from the deleted modules; remove what becomes dead.
- `src/CLAUDE.md`: remove lever 1/2 architecture notes; keep the rolling-buffer + lever 0 notes.

HOW: do NOT blind `git revert` the commits — later commits (dispatch-overlap experiment + its revert 90f905c, plugin-id migration 4159ab2) touched adjacent lines. Use the pre-lever shape as the reference (`git show 66a62bd^:src/pacer.ts`, `git show 66a62bd^:src/search.ts`) and hand-edit forward. Start by deleting the two policy modules and letting `npm run typecheck` enumerate every consumer.

BENCH HARNESS refs (`bench/harness/page.ts` calls `overrideDesktopWebgpuSizing` / `overrideWindowFocus`; `bench/harness/batch-sizing-spec.mjs`; `scripts/bench-sweep*.mjs`) are handled by the follow-up ticket, but this ticket MUST leave `npm run bench` runnable in the container — so strip the two override calls from `bench/harness/page.ts` here (the harness header in `bench/harness/run.mjs` and docs are the follow-up).

## Acceptance Criteria

- `npm run typecheck` and `npm run test` green.
- `src/pacing-policy.ts`, `src/pacing-policy.test.ts`, `src/pacing-wiring.test.ts` deleted; `grep -rn "performanceMode\|batchSizingFor\|windowStateNow\|overrideWindowFocus\|overrideDesktopWebgpuSizing\|paceGatedDispatches" src bench` returns nothing.
- ONE batch sizing constant (512/8) in `src/batch-sizing.ts`; `warmupGridFor` still derives the iframe grid from it; test pins that `src/search.ts` flush size and `src/embedder.ts` warmup grid read the same constant.
- `src/pacer.ts` `pace()` takes no argument; a test pins hidden → cheapYield (no rIC) and visible → rIC chain.
- Lever 0 untouched: `warnIfIndexingOnCpu` still fires at reindex start on wasm fallback, pinned by a test; `src/backend-warning.ts` unchanged.
- Performance mode toggle gone from `src/settings-tab.ts`; an old data.json carrying `performanceMode` loads without error (test).
- `npm run bench` (container, wasm) runs to completion.
- `change_log` entry written; `src/CLAUDE.md` updated.


## Notes

**2026-09-03T17:10:00Z**

ANALYSIS BEHIND THE DECISION (session 2026-09-03):
The "indexing perf improvement" is three layers, not one.
- Layer 0, per-bucket rolling buffer (src/search.ts, 2026-06-03): always on, focus-independent, 45%→85% padding efficiency, dispatches 1865→~520. The real win. KEEP.
- Lever 1, batchSizingFor (512/8 → 2048/32 on desktop WebGPU): only handed out on pacing-policy fullSpeed().
- Lever 2, pacingPolicyFor: fullSpeed() only when unfocused / hidden / Performance mode. A FOCUSED window runs the pre-lever path byte-for-byte.
Therefore levers 1+2 are ONE feature ("faster when nobody is looking"), and the bench's −17.5% is the BENCH_PACING=unfocused number. Any speedup observed while watching the UI focused is Layer 0.
Robustness verdict: the levers are well built (one resolver, base-grid ⊂ desktop-grid invariant pinned by tests, safe degradation) — this is a COST decision, not a bug fix. Cost: ~830 lines across 4 modules+tests, a user-facing setting, per-dispatch hasFocus() polling, mid-pass tier switching, the sizing→warmup-grid→fingerprint→identity invariant web, and a 2048/32 constant tuned on ONE GPU (Radeon 8060S) that would need re-sweeping on every model/GPU change.
