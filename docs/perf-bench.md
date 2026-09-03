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
| Host, macOS (untested) | `npm run bench:host` | `webgpu`, no extra flags (Chromium ships WebGPU over Metal) | same |

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
- `BENCH_BATCH_SIZING=budget/max` (WebGPU only) — run with that desktop-WebGPU
  batch sizing instead of the shipped constant; see "Lever 1" below.

The first run ever downloads the ~100 MB model into the persistent Chromium
profile `.bench-cache/` (git-ignored); every later run hits that cache. The
Linux-only WebGPU flags (`--enable-features=Vulkan,VulkanFromANGLE
--use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`) live in ONE
place, `DEVICE_PROFILES` in `bench/harness/run.mjs`; the runner prints the
executable and flags it is about to use before every run so the setup is never
a guess. `bench:host` fails loudly (no numbers) unless the model actually
landed on a `real` WebGPU adapter — a "webgpu" number can never silently be a
SwiftShader or wasm number.

The software-adapter rejection itself is pinned by
`bench/harness/webgpu-software.test.ts`: `BENCH=1 npx vitest run
bench/harness/webgpu-software.test.ts` runs the harness in probe mode under
`BENCH_DEVICE=webgpu-software` / `webgpu-absent` inside the container (no GPU
needed) and asserts both land on wasm for the right reason. Skipped in plain
`npm run test`.

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
| `paddedTokens` | Total tokens the forward passes actually saw: rows × padded length per dispatch (wasm pads to the batch max, WebGPU to the bucket). Divide by `embedDispatches` for the average dispatch shape. |
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
| host: Fedora, Ryzen AI MAX+ 395 / Radeon 8060S, 32 thr, Playwright Chromium 151 | 2026-09-03 | a77c670 | wasm | 12 (67 chunks) | 16592.5 | 0.72 | 4.04 | 28 | 2.39 | spread 1.1 %; paceWait 1.5 ms; coldStart 1139 ms |
| host (same, + Linux WebGPU flags, adapter amd/rdna-3 `real`) | 2026-09-03 | a77c670 | **webgpu** (reference) | 12 (67 chunks) | 1563.6 | 21.59 | 120.55 | 28 | 2.39 | spread 4.4 %; paceWait 0.9 ms; embed only 468 ms, ≈1000 ms is the post-index buffer-pool release |
| container: podman on the same host, no GPU, system Chromium 151 | 2026-09-03 | 9dfbb21 (src identical to a77c670) | wasm | 12 (67 chunks) | 16734.9 | 0.72 | 4.00 | 28 | 2.39 | spread 3.1 %; paceWait 2.4 ms; coldStart 1093 ms |
| host (same, WebGPU flags, adapter amd/rdna-3 `real`) | 2026-09-03 | 206bcbc | **webgpu**, sizing 512/8 (pre-lever-1) | 70 | 3492 | — | — | 156 | 2.52 | 70-file reference for lever 1; embed 2250 ms; p95 dispatch 17 ms |
| host (same) | 2026-09-03 | 206bcbc | **webgpu**, sizing 2048/32 (lever 1) | 70 | 2882 | — | — | 40 | 9.82 | spread 7.3 %; embed 1727 ms; p95 dispatch 56 ms; −17.5 % wall-clock |
| host: Fedora, Ryzen AI MAX+ 395 / Radeon 8060S, 32 thr, Playwright Chromium 151 | 2026-09-03 | 0899abc | wasm | 70 (393 chunks) | 96362.7 | 0.73 | 4.08 | 156 | 2.52 | **70-file two-baseline pair.** spread 0.4 %; embed 96117 ms (99.7 % of wall); paceWait 148 ms; coldStart 1160 ms |
| host (same, + Linux WebGPU flags, adapter amd/rdna-3 `real`) | 2026-09-03 | 0899abc | **webgpu** (reference), sizing 2048/32 (shipped) | 70 (393 chunks) | 2882.9 | 36.11 | 202.72 | 40 | 9.82 | **70-file decider.** spread 1.6 %; embed 1727 ms (≈60 % of wall); post-index buffer-pool tail ≈1155 ms (≈40 %, was ≈2/3 at 12 files); paceWait 8 ms; coldStart 1560 ms |
| container: podman on the same host, no GPU, system Chromium 151 | 2026-09-03 | 0899abc | wasm | 70 (393 chunks) | 96553.7 | 0.72 | 4.07 | 156 | 2.52 | spread 0.2 %; within 0.2 % of host wasm (faithful WASM regression guard); paceWait 182 ms; coldStart 1059 ms |

Raw ndjson lines for these rows are pasted in ticket
`nid_d5o2w9eb3d1l885d2q8kk992l_e` (12-file pair) and
`nid_dgaqfjqgyi78zwcxmy3q8e6k8_e` (70-file pair). Production settings at
capture: `ROLLING_BUDGET = 512`, `ROLLING_MAX = 8` (since lever 1:
`BASE_BATCH_SIZING` in `src/batch-sizing.ts`, 512/8 base; desktop-WebGPU
`DESKTOP_WEBGPU_BATCH_SIZING` 2048/32), idle-gated pacer. The 70-file pair
above is the two-baseline convention's canonical capture; the earlier 12-file
pair is kept for context but lever tickets MUST compare against a
`BENCH_FILES=70` baseline from the same commit.

### Reading the baseline

- **Effective batch is 2.39 of `ROLLING_MAX = 8`, on every device.** 10766
  padded tokens (wasm; 12048 on WebGPU, which pads to the bucket) over 28
  dispatches is ≈ 385 tokens per dispatch, i.e. the
  512-token `ROLLING_BUDGET` closes a batch after ~2.4 chunks, long before the
  8-chunk cap. The batching lever has to lift the budget (or shrink padding)
  to move `embedDispatches` at all.
- **Pace-wait share is ≈ 0 % headless** (1–2 ms of 1.5–17 s). The bench
  cannot see the pacing lever; that lever must be judged in real Obsidian, or
  the harness must simulate a busy compositor.
- **WASM is 100 % embed-bound**: embed 16.6 s of 16.7 s wall-clock, batch
  latency p50 ≈ 630 ms per ≈ 2.4-chunk dispatch. Host and container WASM agree
  within 1 % (same CPU), so the container run is a faithful regression guard
  for WASM.
- **WebGPU headline is dominated by a fixed post-index cost at this corpus
  size.** Embed took 468 ms (p50 15 ms per dispatch) and the whole index pass
  543 ms, but `wallClockMs` is 1564 ms because `reindexAll()` releases the
  WebGPU buffer pool afterwards (986–1073 ms across the 3 runs, ≈ 1000 ms). At
  12 files that is ~2/3 of the
  headline; a lever that only speeds up embedding can move the WebGPU median
  by at most ~30 %, so compare `embedDurationMs` alongside `wallClockMs`, or
  bench at 70+ files where embedding dominates again. **Confirmed at 70 files
  (2026-09-03 pair, commit 0899abc):** the fixed post-index tail stays flat at
  ≈1155 ms while embed grows to 1727 ms, so the buffer-pool-release share drops
  from ≈2/3 to ≈40 % of the 2883 ms headline (embed is now ≈60 %). An embedding
  lever can move the 70-file WebGPU median by up to ~60 %, so the 10 %-median
  rule is no longer blunted at that corpus size — this is why the two-baseline
  convention pins `BENCH_FILES=70`.
- WebGPU `coldStartMs` (1547 ms) is with `warmupSkipped = true` (persistent
  profile); WASM cold start is ≈ 1.1 s.

## Lever 1 — desktop-WebGPU batch sizing (`nid_0yhtxzgrmly7zk6m6quiqfpil_e`)

What changed (code): the budget/max pair moved out of `src/search.ts` into
`src/batch-sizing.ts` as a `BatchSizing` resolved per index pass from
`(isMobile, resolved device)`. Only desktop + WebGPU gets
`DESKTOP_WEBGPU_BATCH_SIZING`; mobile on any device and desktop + WASM keep the
base 512/8 byte-for-byte (WASM: the budget also caps the synchronous
per-dispatch stall and batch size measured a wash). The iframe warmup grid is
derived from the same sizing PER BUCKET (`warmupGridFor`: sizes
`1..rollingBatchFor(bucket)` per seq bucket), carried in the load payload, and
pinned by the warmup-skip fingerprint. Base grid: 40 passes (was the flat
[1..8] × 9 = 72). `results.ndjson` rows now carry `batchSizing`.

### Sizing sweep on the host: `npm run bench:sweep` (human runs; the agent container has no GPU)

The container WASM run only validates correctness (dispatches 28 / effective
batch 2.39 must match the baseline row, because desktop-WASM sizing is
unchanged). The gain is measured only on the host WebGPU run, and ONE command
does the whole sweep — no source edit per candidate:

```sh
npm run bench:sweep          # idle machine, Obsidian closed; ≈ 7 × (1 + 3 runs)
```

`scripts/bench-sweep.mjs` runs the reference 512/8 first, then every candidate
(default `1024/16,1024/32,2048/16,2048/32,4096/16,4096/32`; override with
`BENCH_CANDIDATES=...`), each as a normal bench session (1 warm-up + `BENCH_REPS`
measured runs, `BENCH_FILES` defaulting to 70 here) with `BENCH_BATCH_SIZING`
set, which swaps `DESKTOP_WEBGPU_BATCH_SIZING` for that process through the
one resolver in `src/batch-sizing.ts` — so the flush size, the warmup grid and
the warmup fingerprint all follow the candidate. Because the grid is part of
the fingerprint, each candidate's warm-up run is a real cold-grid warmup and
its `warmupMs` is the "warmupMs (cold)" column. Every run still lands in
`.bench/results.ndjson` (rows carry `batchSizing` + `batchSizingOverride`).

At the end the script applies the 10 %-median rule per candidate (plus: zero
`embedRecycles`, otherwise the shape hit the ORT-Web overflow path and is out),
picks the winner (best whole-percent wall-clock gain; ties → embed gain →
smaller budget, the shorter worst-case stall), prints a markdown report and
writes it to `.bench/sweep-<timestamp>.md`. **Paste that report into the
ticket**; its VERDICT line names the exact constant to set (option A), says to
keep 512/8 (option B), or asks for a rerun when the reference itself is too
noisy. The table below is the same shape as the report, so a merged row can be
copied straight in.

Sweep of 2026-09-03 on the reference host (commit 206bcbc, adapter amd/rdna-3
`real`, 70 files, 3 measured runs each; raw report `.bench/sweep-2026-09-03T02-36-59-620Z.md`):

| candidate (budget/max) | grid passes | wall-clock (ms) | embed (ms) | dispatches | eff. batch | p95 batch (ms) | spread | warmupMs (cold) | wall-clock vs ref | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 512/8 (reference, 70 files) | 40 | 3492 | 2250 | 156 | 2.52 | 17 | 3.8 % | 583 | — | base sizing; 12-file reference above is not comparable |
| 1024/16 | 81 | 2955 | 1798 | 73 | 5.38 | 31 | 1.3 % | 1017 | −15.4 % | PASS |
| 1024/32 | 102 | 3011 | 1818 | 72 | 5.46 | 32 | 2.8 % | 1278 | −13.8 % | PASS |
| 2048/16 | 108 | 2915 | 1754 | 44 | 8.93 | 56 | 2.2 % | 1306 | −16.5 % | PASS; equivalent to the winner within noise |
| **2048/32** | 161 | **2882** | **1727** | 40 | 9.82 | 56 | 7.3 % | 1950 | **−17.5 %** | **PASS — shipped as `DESKTOP_WEBGPU_BATCH_SIZING`** |
| 4096/16 | 131 | 2955 | 1819 | 32 | 12.28 | 115 | 0.7 % | 1572 | −15.4 % | PASS; p95 stall doubles for no gain |
| 4096/32 | 216 | 2925 | 1781 | 24 | 16.38 | 111 | 1.0 % | 2560 | −16.2 % | PASS; p95 stall doubles for no gain |

Reading it: every candidate clears the rule and they sit within a 4-point band
(−13.8 … −17.5 %), i.e. the gain comes from leaving 512/8, not from the exact
pair — batching past ~9 effective is a plateau on this GPU. The pick follows the
rule's tie-break (whole-percent wall-clock gain, then embed gain); 2048/16 is
the same choice within noise and would be the pick if the 7.3 % spread of
2048/32 were to repeat. 4096 buys nothing and doubles the p95 dispatch (the
non-preemptible stall), so it is out on UX grounds alone. Cold warmup grew from
583 ms (40 passes) to 1950 ms (161 passes), once per install (fingerprinted).
The value is a property of the shipped model + GPU class: re-sweep on a model
switch.

**Not a user setting (decided 2026-09-03, ticket `nid_ia9lbslebos19fli7s2g3b6i8_e`).**
Because the sweep is a plateau, the pair is not exposed; the only felt
difference is the stall, and that is lever 2's job
(`nid_td0kh5ezmq4tkfmhfx82d1pcr_e`): focused window + Performance mode off →
512/8 (do not stall the app by default), unfocused/hidden or Performance mode
on → 2048/32. The switch needs no re-warm: per bucket the 2048/32 grid is a
superset of the 512/8 grid, so the largest tier is warmed once and the tier
only changes the flush size.
