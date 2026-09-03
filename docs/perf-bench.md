# Indexing-performance bench

THE bench to run when touching `src/search.ts` batching, `src/pacer.ts`, or the
`src/iframe-runner.ts` load/warmup path. It reindexes a committed synthetic
corpus (`bench/corpus/`) through the REAL production stack (`LocalEmbedder` →
`IframeRunner` → transformers.js, `SearchOrchestrator`, `IndexStore` on a real
IndexedDB) inside a real Chromium page, and reports throughput.

Plan of record: ticket `nid_mw6gkmuurjhiqva4rr6doenul_e`. Harness:
`bench/harness/run.mjs` (its header documents every env var). Runner:
`scripts/bench.mjs`.

## How to run

| Where | Command | Device | Chromium |
|---|---|---|---|
| Dev container (no GPU) | `npm run bench` | `wasm` | system `/usr/bin/chromium` |
| Host, Fedora / Linux | `npm run bench:host` | `webgpu` (real GPU **required**) | Playwright's bundled build, once: `npm run bench:setup` |
| Host, macOS | `npm run bench:host` | `webgpu` | same |

- `BENCH_DEVICE=wasm npm run bench:host` — the env var always overrides the
  script's default device. The two-baseline convention below uses exactly this.
- `BENCH_FILES=N` — index only the first N corpus files (sorted). Container
  default is 12 (≈ 67 chunks, < 20 s warm at ~4 chunks/s, single-threaded ORT
  wasm kernels as in production). On a host use `BENCH_FILES=70` (the prefix
  pinned by `bench/corpus.test.ts` that covers every `SEQ_BUCKETS` entry) or the
  full corpus (`BENCH_FILES=1000`).
- `BENCH_REPS=N` — measured runs (default 3). There is always 1 warm-up run.
- `BENCH_FORCE=1` — skip the CPU-idle gate (see below).
- `BENCH_CHROMIUM=/path` — use a specific Chromium binary instead of the defaults above.

The first run ever downloads the ~100 MB model into the persistent Chromium
profile `.bench-cache/` (git-ignored); every later run hits that cache. On
Linux the WebGPU flags (`--enable-features=Vulkan,VulkanFromANGLE
--use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`) live in ONE
place, `DEVICE_PROFILES` in `bench/harness/run.mjs`; the runner prints the
executable and flags it is about to use before every run so the setup is never
a guess. `bench:host` fails loudly (no numbers) unless the model actually
landed on a `real` WebGPU adapter — a "webgpu" number can never silently be a
SwiftShader or wasm number.

### What one `npm run bench` does

1. Prints Chromium executable + flags.
2. **CPU-idle gate**: samples CPU for 2 s; aborts (exit 2) when busy > 20%,
   because a bench on a busy machine is noise. `BENCH_FORCE=1` overrides.
3. Runs the harness 1 warm-up + 3 measured times (fresh Chromium page and
   fresh IndexedDB per run; the model cache is shared).
4. Appends one JSON line per run (warm-up included, tagged `phase`) to
   `.bench/results.ndjson` (git-ignored): machine (CPU model, cores, platform),
   git commit + dirty flag, date, device, files, adapter info, and the full
   harness result object. Local history for your own before/after comparisons.
5. Prints a table: median, min, max, and spread per metric over the measured runs.

## What the numbers mean

| Metric | Meaning |
|---|---|
| `wallClockMs` | **Headline.** Wall-clock of `SearchOrchestrator.reindexAll()` only. Model load + warmup are excluded. |
| `filesPerSec`, `chunksPerSec` | Throughput derived from the headline; chunks/s is the number to compare across corpus sizes. |
| `embedDispatches` | Number of embed batches sent to the runtime. Fewer, fuller dispatches is what the batching levers aim for. |
| `effectiveBatch` | vectors ÷ dispatches: the average batch size actually achieved. |
| `paddedTokens` | Tokens spent on padding inside batches (bucketed sequence lengths). Waste, but sometimes the price of bigger batches. |
| `paceWaitMs` | Total time spent yielding to the compositor (`src/pacer.ts`). What the pacing lever attacks. |
| `coldStartMs`, `warmupMs` | Model load and WebGPU warmup, reported for context, NOT part of the headline. `warmupMs` is null on wasm; on WebGPU the persistent profile skips warmup on later runs (`warmupSkipped`). |
| `spread` | `(max − min) / median` across the measured runs, in percent. Run-to-run noise. |

The ndjson `result` object also carries `embedBatchLatencyMs` (p50/p95),
per-phase durations (`embedDurationMs`, `chunkDurationMs`, `bm25DurationMs`,
`commitDurationMs`), and the resolved device / dtype / adapter classification.

## Accepting a lever: the 10 %-median rule

A lever counts as an improvement only when, **on the host WebGPU run**:

- the median `wallClockMs` improves by **≥ 10 %** against the baseline, AND
- the spread of both the baseline and the candidate is **below 10 %** (otherwise
  the "gain" is inside the noise — rerun on an idle machine, or with more
  `BENCH_REPS`, before deciding).

Agents self-iterate on the container WASM run to catch regressions and gross
errors, but WASM is not the decider: batch size is a known wash on WASM
(`src/search.ts`, rolling-budget comment) and pacing is nearly free headless.

## Two-baseline convention

Every baseline is captured on the reference host twice, from the same commit,
back to back on an idle machine:

```sh
BENCH_DEVICE=wasm   BENCH_FILES=70 npm run bench:host
BENCH_DEVICE=webgpu BENCH_FILES=70 npm run bench:host
```

Host WASM shows what users without a working GPU get; host WebGPU is the
decider for batching/pacing levers. Copy the medians into the table below (the
`.bench/results.ndjson` line has every field). A container WASM row is welcome
as a third reference for agents but is not a decider.

## Baselines

Filled by the baseline-capture ticket (`nid_d5o2w9eb3d1l885d2q8kk992l_e`) and
by each merged lever ticket. Medians of 3 measured runs; add the spread in the
notes column when it is above 5 %.

| machine | date | commit | device | files | wall-clock (ms) | files/s | chunks/s | dispatches | eff. batch | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
