---
id: nid_0yhtxzgrmly7zk6m6quiqfpil_e
title: "Lever 1: desktop batch sizing — wire embedBatchCeiling, raise rolling token budget/max on desktop, extend warmup grid to match"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_d5o2w9eb3d1l885d2q8kk992l_e]
links: []
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-02T22:54:55Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, lever1]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on the baseline ticket. Measured, not guessed: every variant is run on the host WebGPU bench; keep only >= 10% median wall-clock gain with spread below that (`docs/perf-bench.md`).

## Today (verified)
- `src/search.ts` ~80-91: `ROLLING_BUDGET = 512`, `ROLLING_MAX = 8`, `rollingBatchFor(bucket) = clamp(round(BUDGET/bucket), 1, MAX)` -> {512:1, 256:2, 128:4, <=64:8}. The comment above it still says 1536 -> {512:3,...}: STALE, fix it.
- `src/platform.ts` ~line 131: `embedBatchCeiling()` returns mobile 8 / desktop 32 — ZERO callers.
- `src/iframe-runner.ts` lines 61-62: `WARMUP_BATCH_SIZES = [1..8]`, `SEQ_BUCKETS = [32..512]`; warmup compiles one pipeline per (batch, seq) pair (~50 ms each cold, Dawn disk-cached after). ORT-Web WebGPU history: arbitrary un-warmed shapes hit a SafeInt overflow (see comments ~811-830 and the recycle+retry in `embedOneBatch` ~799-835). Any new shape MUST be in the warmed grid.
- Stall contract (`src/search.ts` ~64-73): a dispatch is non-preemptible; worst-case UI stall = the largest dispatch's forward time; the token budget caps that. Bigger desktop batches trade stall length for throughput — that is why lever 2 (focus-aware pacing / Performance mode) exists; this ticket only adds the desktop sizing PARAMETERS and wiring.

## What to build
1. Introduce a `BatchSizing` value (e.g. `{ budgetTokens, maxBatch }`) resolved per platform via `embedBatchCeiling()` (desktop 32 / mobile 8 — mobile values MUST stay byte-identical to today: budget 512, max 8). Desktop candidates to bench: budget 1024/2048/4096 with max 16/32; pick by measurement, record all rows in `docs/perf-bench.md`.
2. Extend the iframe warmup grid on desktop to exactly the shape set the new sizing can emit (compute it from the sizing, don't hand-list; mobile grid unchanged). Keep the warmup-skip fingerprint (localStorage, ~line 820-830) keyed on the grid so an old fingerprint does not skip new shapes.
3. Keep the drain-remainders invariant: partial buckets flush at sizes 1..max-1, all in the warmed grid.
4. Tests: unit tests for the sizing function (mobile unchanged; desktop values), for the grid derivation (every `rollingBatchFor` output and every remainder is in the grid), and the existing `src/search.ts` batching tests stay green. Bench rows before/after on the host (human runs; attach to ticket).

## Files
- `src/search.ts`, `src/platform.ts`, `src/iframe-runner.ts` (+ tests), `docs/perf-bench.md`.

## Acceptance Criteria

embedBatchCeiling has real callers; desktop sizing chosen from bench rows with >= 10% median gain on host WebGPU; warmup grid derived from sizing and covered by a test; mobile sizing/grid byte-identical; stale ROLLING_BUDGET comment fixed.

