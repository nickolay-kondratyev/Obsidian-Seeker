---
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_0yhtxzgrmly7zk6m6quiqfpil_e
title: "Lever 1: desktop batch sizing — wire embedBatchCeiling, raise rolling token budget/max on desktop, extend warmup grid to match"
status: in_progress
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_d5o2w9eb3d1l885d2q8kk992l_e]
links: []
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-03T01:28:20Z
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
1. Introduce a `BatchSizing` value (e.g. `{ budgetTokens, maxBatch }`) resolved from BOTH platform AND the resolved device: the larger sizing applies ONLY to desktop + `webgpu`. Mobile (any device) AND desktop + `wasm` MUST stay byte-identical to today (budget 512, max 8): on the WASM path the budget also caps the synchronous per-dispatch stall and batch size was measured a wash (`src/search.ts` ~82-89, experiment closed 2026-06-11) — and desktop-WASM is exactly where the Linux-without-flags users sit until lever #0b gets them onto the GPU. Extend `embedBatchCeiling()` (or a successor taking `{ isMobile, device }`) rather than adding a second sizing source; the orchestrator already knows the device via `embedder.device` (`src/embedder.ts` ~line 211). Desktop-WebGPU candidates to bench: budget 1024/2048/4096 with max 16/32; pick by measurement, record all rows in `docs/perf-bench.md`. Consequence for the bench: the container WASM run validates correctness only (tests, counters); the gain can only be measured on the host WebGPU run.
2. Extend the iframe warmup grid on desktop-WebGPU to exactly the shape set the new sizing can emit (compute it from the sizing, don't hand-list; mobile grid unchanged). Derive it PER BUCKET — for each seq bucket the sizes `1..rollingBatchFor(bucket)` (flush size plus drain remainders) — not the cross product `[1..max] x SEQ_BUCKETS`: with budget 2048 / max 32 that is ~160 passes vs 288, and at ~50 ms per cold pass the difference is several seconds of first cold start. Report the before/after `warmupMs` (load entry) in the ticket. Plumbing: the child script receives the grid by template injection (`WARMUP_BATCH_SIZES` at `src/iframe-runner.ts` ~line 473, consumed by the nested loops at ~835-845), so the injected value must become the per-bucket list (or a `{bucket: maxBatch}` map) and the loops adapt. The warmup-skip fingerprint is PARENT-side: `WARMUP_FP_KEY` and its composition in `src/embedder.ts` ~lines 33-52 already include `WARMUP_BATCH_SIZES`/`SEQ_BUCKETS`; make the composition include the resolved grid so an old fingerprint never skips new shapes.
3. Keep the drain-remainders invariant: partial buckets flush at sizes 1..max-1, all in the warmed grid.
4. Tests: unit tests for the sizing function (mobile unchanged; desktop values), for the grid derivation (every `rollingBatchFor` output and every remainder is in the grid), and the existing `src/search.ts` batching tests stay green. Bench rows before/after on the host (human runs; attach to ticket).

## Files
- `src/search.ts`, `src/platform.ts`, `src/iframe-runner.ts` (+ tests), `docs/perf-bench.md`.

## Acceptance Criteria

embedBatchCeiling has real callers; desktop sizing chosen from bench rows with >= 10% median gain on host WebGPU; warmup grid derived from sizing and covered by a test; mobile sizing/grid byte-identical; stale ROLLING_BUDGET comment fixed.

