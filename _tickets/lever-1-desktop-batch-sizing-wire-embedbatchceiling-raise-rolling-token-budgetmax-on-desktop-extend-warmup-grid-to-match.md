---
session_ids: [{"a": "claude", "type": "execution", "id": "1803c5cf-03b2-49dd-b7fe-c9b1667dd88b"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_0yhtxzgrmly7zk6m6quiqfpil_e
title: "Lever 1: desktop batch sizing — wire embedBatchCeiling, raise rolling token budget/max on desktop, extend warmup grid to match"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_d5o2w9eb3d1l885d2q8kk992l_e]
links: []
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-03T01:36:35Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, lever1, decide, need-human]
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

---

## Resolution so far (agent, 2026-09-03, commit 66a62bd on this branch)

Everything except the measured pick is built and green (typecheck, 1271 tests, production build, container WASM bench).

### What was built, where
- `src/batch-sizing.ts` (new, pure): `BatchSizing {budgetTokens, maxBatch}`, `BASE_BATCH_SIZING` = 512/8, `DESKTOP_WEBGPU_BATCH_SIZING` = **2048/16 PROVISIONAL**, `batchSizingFor({isMobile, device})` (larger sizing ONLY for desktop + webgpu), `rollingBatchFor(bucket, sizing)`, `warmupGridFor(sizing, SEQ_BUCKETS)` (per bucket: `{bucket, maxBatch: rollingBatchFor}`), `warmupPassCount`, `warmupGridKey`.
- `src/search.ts`: `ROLLING_BUDGET/ROLLING_MAX/rollingBatchFor` removed; `embedAndCommitFiles` resolves `sizing` once per pass from `isMobilePlatform()` + `this.embedder.device`; flush/drain/checks use it. Stale "1536 → {512:3…}" comment fixed. A mid-pass recycle can only fall back webgpu→wasm; base grid ⊆ desktop grid (tested), so shapes stay warmed.
- `src/platform.ts`: `embedBatchCeiling()` (mobile 8 / desktop 32, zero callers) RETIRED in favour of `batchSizingFor` — the "successor taking {isMobile, device}" option from the spec. Its doc block now points to batch-sizing.ts.
- `src/iframe-runner.ts`: `WARMUP_BATCH_SIZES` export and template injection removed; `IframeRunner.load(req: LoadRequest)` (options object) carries `warmupGrid`; child `loadModel(..., warmupGrid)` loops `for cell of warmupGrid / for n in 1..cell.maxBatch`. Query-floor loop unchanged (every cell has maxBatch ≥ 1 so (1 × SEQ_BUCKETS) is still warmed first).
- `src/embedder.ts`: `indexWarmupGrid()` = grid for this platform's WebGPU sizing (warmup only runs on the WebGPU path, so the grid is computed for device 'webgpu' regardless of what the ladder resolves); `warmupFingerprint(..., grid)` pins `warmupGridKey(grid)` instead of `WARMUP_BATCH_SIZES` → every install re-warms once after this lands.
- Tests: `src/batch-sizing.test.ts` (sizing per platform×device, base flush sizes, grid derivation, the every-flush-size-and-remainder-is-warmed invariant for both sizings, base ⊆ desktop), `src/iframe-runner.test.ts` (child loops over payload grid, no flat list), `src/embedder.test.ts` (fingerprint differs across grids).
- Bench: `bench/harness/page.ts` reports `batchSizing`; `run.mjs` puts it in the ndjson summary. `docs/perf-bench.md` gained a "Lever 1" section with the sweep procedure and an empty candidate table.

### Container WASM bench (correctness only, commit 66a62bd, 12 files)
wallClock median 16487 ms (spread 0.8 %), dispatches 28, effective batch 2.39, paddedTokens 10766, `batchSizing {512, 8}` — identical counters to the baseline row (desktop-WASM sizing unchanged, as required).

### Grid pass counts (cold warmup, ~50 ms each)
base 512/8: 40 (was 72 as the flat [1..8]×9 cross product) · 1024/16: 81 · 1024/32: 102 · 2048/16: 108 · 2048/32: 161 · 4096/16: 131 · 4096/32: 216.

### Assumptions made (flag if wrong)
1. **Mobile grid is derived per bucket too** (40 passes instead of the old 72). The spec says "mobile grid unchanged" but also "compute it from the sizing, don't hand-list" and "derive PER BUCKET"; one derivation path for both platforms was chosen over a mobile-only cross-product special case. Mobile SIZING is byte-identical, so every shape mobile can dispatch is still warmed (tested); the 32 dropped shapes (e.g. 8×512) were never dispatched under 512/8. Net effect on mobile: a shorter cold warmup. Revert by returning the cross product for `isMobile` in `warmupGridFor` if the literal reading is wanted.
2. Sizing is resolved once per index pass, not per dispatch.
3. `LoadRequest` options object replaced the 5-positional `runner.load` signature (one production call site).

## DECISION NEEDED (human): pick DESKTOP_WEBGPU_BATCH_SIZING from host WebGPU rows

**Question.** Which budget/max lands as `DESKTOP_WEBGPU_BATCH_SIZING` in `src/batch-sizing.ts`? The acceptance criterion ("chosen from bench rows with ≥ 10 % median gain on host WebGPU") cannot be met from the container: it has no GPU, and batch size is a known wash on WASM. The code currently ships the PROVISIONAL 2048/16; nothing was measured.

**Procedure (host, idle machine, Obsidian closed) — ONE command, no source edits:**
```sh
npm run bench:sweep
```
`scripts/bench-sweep.mjs` runs the reference 512/8 and then every candidate (1024/16, 1024/32, 2048/16, 2048/32, 4096/16, 4096/32; `BENCH_CANDIDATES=...` to change) at `BENCH_FILES=70`, each as a full bench session with `BENCH_BATCH_SIZING` set (swaps the constant for that process through the one resolver in `src/batch-sizing.ts`, so flush size, warmup grid and fingerprint all follow the candidate; the warm-up run of each is the real cold-grid warmup and yields the warmupMs column). It applies the 10 %-median rule + zero-recycle check, prints a markdown report with a VERDICT line naming the exact constant to set, and writes it to `.bench/sweep-<timestamp>.md`. Expect ≈ 7 × (1 + 3) runs, roughly 10–15 min. **Paste the report (or its path) back to the agent**; the agent sets the constant, fills the table in `docs/perf-bench.md`, and closes the ticket.

**What the numbers are.** `budget/max` is NOT a ratio: `budgetTokens` is the target batch × seq tokens per dispatch (caps the non-preemptible forward pass, i.e. the worst-case UI stall) and `maxBatch` is the ceiling on chunks per dispatch (binds only for short chunks). Batch for a seq bucket = clamp(round(budget / bucket), 1, max): with 2048/16 a 512-token bucket flushes 4 chunks per GPU dispatch, 256 → 8, ≤128 → 16.

**Options.**
- A. Winner by the 10 %-median rule on `wallClockMs` (tie-break: `embedDurationMs`, then the SMALLER budget for the shorter worst-case stall — lever 2 owns pacing but a smaller stall is free UX).
- B. No candidate clears 10 % → set `DESKTOP_WEBGPU_BATCH_SIZING` = 512/8, keep the wiring (grid/fingerprint/tests still valid; the constant becomes the lever 2 / future knob) and note the finding in `docs/perf-bench.md`.

**Recommendation.** Expect A with 2048/16 or 2048/32: the baseline's effective batch of 2.4 against 15 ms/dispatch p50 says per-dispatch overhead dominates on this GPU, and 2048 lifts the mean flush 4× while keeping the 512-bucket dispatch at 4 × 512 (worst-case stall ≈ 4× today's). After the pick: set the constant, run `npm run test`, fill the doc table, close the ticket (`ticket close nid_0yhtxzgrmly7zk6m6quiqfpil_e`), and run `change_log` for the entry.
