---
closed_iso: 2026-09-03T14:52:16Z
id: nid_shw3c2udyuva92sa81oa5qxyg_e
title: 'Experiment: two-deep embed dispatch overlap (measure on host WebGPU bench;
  keep only if >= 10%, else revert)'
status: closed
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_td0kh5ezmq4tkfmhfx82d1pcr_e]
links: []
created_iso: '2026-09-02T22:54:56Z'
status_updated_iso: 2026-09-03T14:52:16Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, experiment]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker
---
Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Priority 3 experiment, after levers 1-2. Expected low ROI: ORT-Web serializes work on one WebGPU device queue, so overlap can only hide CPU-side gaps (tokenize, iframe postMessage, readback, quantize, IndexedDB commit) between forward passes, and bigger batches (lever 1) already shrink the number of gaps.

## What
Allow at most TWO batches in flight in the flush loop of `src/search.ts` (`embedOneBatch` ~799-847 and the bucket flush/drain at ~983-1000 / ~1248 / ~1278): dispatch N+1 before awaiting N's vectors, preserving (a) per-file atomic commit order, (b) the recycle+retry on SafeInt overflow (which assumes ONE outstanding dispatch today — redesign it: on failure drain the other in-flight promise before recycling), (c) the pacer semantics from lever 2, (d) memory bounds on mobile (mobile stays single-flight).

## Rule
Bench before/after on the host WebGPU run with lever 1 + 2 settings. Keep only with >= 10% median wall-clock gain and spread below that; otherwise REVERT the code and record the measured result in `docs/perf-bench.md` so nobody retries blind.

## Files
- `src/search.ts`, `src/embedder.ts` / `src/iframe-runner.ts` if the RPC layer needs to accept two outstanding `embedBatch` calls (check the per-RPC timeout and id handling in `send`).

## Acceptance Criteria

Either merged with bench rows showing >= 10% gain and tests for ordering/failure handling, or reverted with the measured rows recorded in docs/perf-bench.md.

## Resolution 2026-09-03 — REVERTED (measured, below the 10 % bar)

Implemented the two-deep dispatch queue exactly as specced (bounded queue in
`src/search.ts`'s flush loop, `PacingDecision.dispatchDepth` in
`src/pacing-policy.ts`, drain-other-in-flight-before-recycle redesign, tests
for ordering/failure handling, `BENCH_DISPATCH_DEPTH` + `npm run bench:overlap`
host A/B script), committed as `b09ed99`. Human ran `npm run bench:overlap` on
the reference host (Fedora, Ryzen AI MAX+ 395 / Radeon 8060S, adapter
amd/rdna-3 `real`, 70 files, `unfocused` pacing, 3 measured runs/depth):

| dispatch depth | wall-clock (ms) | embed (ms) | max in flight | spread | vs depth 1 |
|---|---|---|---|---|---|
| 1 (reference) | 2833 | 1706 | 1 | 1.9 % | — |
| 2 | 2620 | 1571 | 2 | 4.9 % | **−7.5 %** |

The overlap measurably happened (max in flight 2, zero embed recycles) but
gained only 7.5 %, under the ticket's ≥ 10 %-median bar, while the p95 dispatch
latency nearly doubled (57 → 102 ms) — a worse UX trade for a sub-threshold
gain. Per the ticket's rule, `b09ed99` was reverted whole (revert commit
`90f905c`) rather than shipped behind a flag; the measured rows are recorded
in `docs/perf-bench.md` under "Experiment — two-deep embed dispatch overlap —
REVERTED" so nobody retries this lever blind. Confirms the ticket's own
pre-registered low-ROI prediction: ORT-Web serialises forward passes on one
WebGPU device queue, so overlap can only hide the CPU-side gap between
dispatches, and lever 1 already shrank that gap to 40 dispatches at 70 files.
Post-revert: full test suite 1370 passed (baseline count, `dispatch-overlap.test.ts`
removed with the revert), typecheck clean.
