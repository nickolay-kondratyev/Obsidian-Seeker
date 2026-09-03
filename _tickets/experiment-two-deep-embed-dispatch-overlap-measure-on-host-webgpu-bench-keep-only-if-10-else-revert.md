---
id: nid_shw3c2udyuva92sa81oa5qxyg_e
title: 'Experiment: two-deep embed dispatch overlap (measure on host WebGPU bench;
  keep only if >= 10%, else revert)'
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_td0kh5ezmq4tkfmhfx82d1pcr_e]
links: []
created_iso: '2026-09-02T22:54:56Z'
status_updated_iso: 2026-09-03T05:02:24Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, experiment, need-human, decide]
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


## Status 2026-09-03 — code + A/B script landed, DECISION PENDING the host run (need-human)

The agent container has no GPU, so the keep/revert decision cannot be made here.
Everything up to the measurement is done and committed on this branch; the human
runs ONE command on the reference host and applies the printed VERDICT.

### What is implemented
- `src/pacing-policy.ts`: `PacingDecision.dispatchDepth` — `DESKTOP_WEBGPU_DISPATCH_DEPTH = 2`
  on the full-speed desktop-WebGPU tier (unfocused / hidden / Performance mode) only;
  `SINGLE_FLIGHT = 1` for the focused (gated) tier, mobile, desktop-WASM. Bench knob
  `overrideDesktopWebgpuDispatchDepth()` mirrors the sizing override.
- `src/search.ts` `embedAndCommitFiles`: the flush loop is a bounded dispatch queue
  (`dispatch` / `awaitVectors` / `settle` / `settleOldest` / `flushBucket`). Invariants:
  (a) settle order = dispatch order → per-file commits land in pass order;
  (b) recycle+retry redesigned: on a failure the OTHER in-flight dispatch is drained
  first (recycle() disposes the runner, which would reject it as DISPOSED and unwind
  the pass), then ONE recycle, then the failed head is re-fired first and every
  drained dispatch that also failed after it; a dispatch is retried at most once
  (`InFlight.recycled`), a real DISPOSED still unwinds with no recycle;
  (c) pacer runs after each result lands, gated tier byte-identical (depth 1);
  (d) mobile single-flight. Back-pressure runs BEFORE the batch is sliced so a
  recycle that lands on WASM shrinks the next slice (caught by
  `src/batch-sizing-wiring.test.ts`).
  `embedDurationMs` is now the union of time with ≥ 1 dispatch outstanding;
  `IndexCompleteEntry.embedMaxInFlight` reports the peak depth reached.
- Tests: `src/dispatch-overlap.test.ts` (14: depth cap per tier, ordering when the
  newer batch lands first, recycle-once-after-drain, retry-both, solo path without a
  second recycle, DISPOSED unwinds), `src/pacing-policy.test.ts` (+7),
  `scripts/bench-overlap-report.test.mjs`. Full suite 1391 passed, typecheck clean.
- Bench: `BENCH_DISPATCH_DEPTH=1|2` (`bench/harness/run.mjs`, `bench/harness/page.ts`),
  rows carry `dispatchDepth`, `dispatchDepthOverride`, `embedMaxInFlight`;
  `npm run bench:overlap` (`scripts/bench-overlap.mjs`) runs depth 1 then depth 2
  from one commit, applies the 10 %-median rule + sanity checks, prints the VERDICT
  and writes `.bench/overlap-<ts>.md`. Docs: `docs/perf-bench.md` "Experiment —
  two-deep dispatch overlap".
- Container WASM regression guard (`npm run bench`, 12 files): dispatches 28 /
  effective batch 2.39 / ~16.6 s, identical to the baseline row (WASM is single-flight
  by design).

### What the human does next (on the reference host, idle, Obsidian closed)
```sh
npm run bench:overlap
```
- **VERDICT KEEP** → leave `DESKTOP_WEBGPU_DISPATCH_DEPTH = 2`, paste the report table
  into `docs/perf-bench.md` (the placeholder row in the experiment section) and here,
  close this ticket.
- **VERDICT REVERT** → set `DESKTOP_WEBGPU_DISPATCH_DEPTH = 1` in `src/pacing-policy.ts`
  (the queue code is then the serial loop; keep or revert the commit per taste — the
  ticket's rule says revert the code), paste the report into `docs/perf-bench.md` so
  nobody retries blind, close this ticket.
- **RERUN** → the reference was noisy; rerun with `BENCH_REPS=5`.
