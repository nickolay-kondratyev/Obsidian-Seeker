---
id: nid_shw3c2udyuva92sa81oa5qxyg_e
title: 'Experiment: two-deep embed dispatch overlap (measure on host WebGPU bench;
  keep only if >= 10%, else revert)'
status: in_progress
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_td0kh5ezmq4tkfmhfx82d1pcr_e]
links: []
created_iso: '2026-09-02T22:54:56Z'
status_updated_iso: '2026-09-03T04:50:30Z'
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
