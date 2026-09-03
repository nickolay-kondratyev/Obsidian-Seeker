---
closed_iso: 2026-09-03T01:26:03Z
session_ids: [{"a": "claude", "type": "execution", "id": "3bfc4eab-94fb-43a9-86ad-1a79cc971b70"}, {"a": "claude", "type": "review", "id": "5fbc3037-a14c-4759-bc60-b1e69dda7046"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_d5o2w9eb3d1l885d2q8kk992l_e
title: "Capture baseline pair on the reference host (WASM vs WebGPU) + container WASM into docs/perf-bench.md"
status: closed
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_eiq9gtj7yeiic6cgztef2c0ki_e]
links: [nid_dgaqfjqgyi78zwcxmy3q8e6k8_e]
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-03T01:26:03Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, baseline]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. NEEDS THE HUMAN to run scripts on the host (the agent container has no GPU). Depends on the runner-ergonomics ticket.

## Steps for the human (agent prepares exact commands and validates the output)
1. On the Fedora host, at the repo root, with Obsidian and other heavy apps closed: `npm run bench:setup` (once), then `BENCH_DEVICE=wasm npm run bench:host` and `BENCH_DEVICE=webgpu npm run bench:host`. Paste both summaries (or the appended `.bench/results.ndjson` lines) into this ticket.
- Added the summary 
2. Agent: run `npm run bench` in the container (WASM) and record it too.
3. Agent: fill the baseline table in `docs/perf-bench.md` (machine, date, commit, device, files, wall-clock, files/s, chunks/s, dispatches, effective batch) and add a one-paragraph reading of the numbers (e.g. pace-wait share, effective batch vs `ROLLING_MAX`). These are the reference numbers for the lever tickets; the host WebGPU row is THE reference.

Reference host (verified 2026-09-02): Fedora Linux, AMD Ryzen AI MAX+ 395 w/ Radeon 8060S iGPU (32 threads), Obsidian 1.13.7 Flatpak, Electron 43.3.0 / Chrome 150. Without flags `navigator.gpu` exists but `requestAdapter()` returns null -> plugin silently resolved to WASM while the setting said Force WebGPU. Verified working flags: `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`. Flatpak persists flags in `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf` (one flag per line).
Bench must use today's production settings (`ROLLING_BUDGET = 512`, `ROLLING_MAX = 8`, idle-gated pacer) — no lever changes may land before this ticket closes.

## Acceptance Criteria

docs/perf-bench.md baseline table has host WASM, host WebGPU and container WASM rows at the same commit; raw JSON lines pasted in this ticket.


## Summary:
```
         > idea /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/_tickets/capture-baseline-pair-on-the-reference-host-wasm-vs-webgpu-container-wasm-into-docsperf-benchmd.md > /tmp/idea_open_log_stdout 2> /tmp/idea_o
m:fedora-desktop d:nickolay-kondratyev_Obsidian-Seeker b:main ○ ❯npm run bench:setup

> seeker@1.1.3 bench:setup
> playwright-core install chromium

BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64.
BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64.
BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64.
m:fedora-desktop d:nickolay-kondratyev_Obsidian-Seeker b:main ○ ❯BENCH_DEVICE=wasm npm run bench:host

> seeker@1.1.3 bench:host
> node scripts/bench.mjs --default-device=webgpu

bench-runner: device=[wasm] files=[12]
bench-runner: chromium=[/home/nickolaykondratyev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome]
bench-runner: flags=[--no-sandbox --disable-dev-shm-usage]
bench-runner: cpu-idle gate: busy=[3%] over 2000 ms — ok
bench-runner: ── warm-up 1/1 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache]
bench: run: device=[wasm] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: warm-up 1/1: wallClock=[16721.7 ms] chunks/s=[4.01] dispatches=[28] (18.8 s incl. launch)
bench-runner: ── measured 1/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache]
bench: run: device=[wasm] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 1/3: wallClock=[16691.6 ms] chunks/s=[4.01] dispatches=[28] (18.3 s incl. launch)
bench-runner: ── measured 2/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache]
bench: run: device=[wasm] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 2/3: wallClock=[16592.5 ms] chunks/s=[4.04] dispatches=[28] (18.3 s incl. launch)
bench-runner: ── measured 3/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache]
bench: run: device=[wasm] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 3/3: wallClock=[16506.7 ms] chunks/s=[4.06] dispatches=[28] (18.2 s incl. launch)

metric           median    min       max       spread
---------------  --------  --------  --------  ------
wallClockMs      16592.50  16506.70  16691.60  1.1%
filesPerSec      0.72      0.72      0.73      1.4%
chunksPerSec     4.04      4.01      4.06      1.2%
embedDispatches  28        28        28        0.0%
effectiveBatch   2.39      2.39      2.39      0.0%
paddedTokens     10766     10766     10766     0.0%
paceWaitMs       1.50      1.50      1.90      26.7%
coldStartMs      1138.90   1080.30   1160      7.0%

(3 measured runs; spread = (max - min) / median. Full lines in /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench/results.ndjson)
m:fedora-desktop d:nickolay-kondratyev_Obsidian-Seeker b:main ○ ❯BENCH_DEVICE=webgpu npm run bench:host

> seeker@1.1.3 bench:host
> node scripts/bench.mjs --default-device=webgpu

bench-runner: device=[webgpu] files=[12]
bench-runner: chromium=[/home/nickolaykondratyev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome]
bench-runner: flags=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist]
bench-runner: cpu-idle gate: busy=[3%] over 2000 ms — ok
bench-runner: ── warm-up 1/1 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_re
bench: run: device=[auto] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: warm-up 1/1: wallClock=[1950.1 ms] chunks/s=[129.07] dispatches=[28] (5.8 s incl. launch)
bench-runner: ── measured 1/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache]
bench: run: device=[auto] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 1/3: wallClock=[1616.7 ms] chunks/s=[123.3] dispatches=[28] (3.7 s incl. launch)
bench-runner: ── measured 2/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache]
bench: run: device=[auto] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 2/3: wallClock=[1563.6 ms] chunks/s=[116.1] dispatches=[28] (3.7 s incl. launch)
bench-runner: ── measured 3/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache]
bench: run: device=[auto] files=[12] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 3/3: wallClock=[1547.8 ms] chunks/s=[120.55] dispatches=[28] (3.6 s incl. launch)

metric           median   min      max      spread
---------------  -------  -------  -------  ------
wallClockMs      1563.60  1547.80  1616.70  4.4%
filesPerSec      21.59    20.79    22.08    6.0%
chunksPerSec     120.55   116.10   123.30   6.0%
embedDispatches  28       28       28       0.0%
effectiveBatch   2.39     2.39     2.39     0.0%
paddedTokens     12048    12048    12048    0.0%
paceWaitMs       0.90     0.80     1        22.2%
coldStartMs      1546.80  1536.20  1547.50  0.7%

(3 measured runs; spread = (max - min) / median. Full lines in /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench/results.ndjson)
m:fedora-desktop d:nickolay-kondratyev_Obsidian-Seeker b:main ○ ❯
```

## Resolution (2026-09-03, agent)

- Host pair was run by the human at commit `a77c670` (clean) with the default `BENCH_FILES=12`, NOT the 70 of the docs' two-baseline convention. Assumption made: accept the 12-file pair as THE baseline rather than block; `docs/perf-bench.md` now states that lever tickets must compare at the same `BENCH_FILES` or recapture at 70 first. Follow-up ticket for the 70-file recapture: `nid_dgaqfjqgyi78zwcxmy3q8e6k8_e` (need-human).
- Container WASM run: `npm run bench` at `9dfbb21` (clean; `src/`, `bench/`, `scripts/` byte-identical to `a77c670`, the only commits in between touch `_tickets/`). Median 16734.9 ms, within 1 % of host WASM (same CPU).
- Baseline table + "Reading the baseline" section filled in `docs/perf-bench.md`. Also corrected the `paddedTokens` metric description there (it is total padded tokens seen by the forward pass, per `src/search.ts` `fPaddedTokens`, not padding waste).
- Non-obvious finding: on WebGPU with 12 files, `wallClockMs` (1564 ms) is ~2/3 the post-index `embedder.recycle()` buffer-pool release (~1070 ms, inside `reindexAll()`), embed itself is 468 ms. Levers that only speed embedding are capped at ~30 % on this headline at 12 files; compare `embedDurationMs` too, or bench at 70+ files.

### Raw ndjson lines — host (measured runs, 3 wasm then 3 webgpu)
```
{"date":"2026-09-03T01:14:53.324Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"fedora-desktop"},"git":{"commit":"a77c670","dirty":false},"benchDevice":"wasm","benchFiles":12,"phase":"measured","rep":1,"adapter":null,"actualDevice":"wasm","result":{"mode":"run","benchDevice":"wasm","requestedDevice":"wasm","actualDevice":"wasm","dtype":"q4","adapter":null,"resolvedReason":null,"resolvedBackend":{"device":"wasm","requested":"auto","reason":null,"adapter":null},"webgpuError":null,"coldStartMs":1080.3,"warmupMs":null,"warmupSkipped":false,"wallClockMs":16691.6,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":0.72,"chunksPerSec":4.01,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":10766,"paceWaitMs":1.5,"embedBatchLatencyMs":{"n":28,"min":96.29999999701977,"max":844.3999999985099,"mean":592.4392857136471,"p50":629.5,"p95":785.6000000014901},"embedDurationMs":16613.4,"chunkDurationMs":44.7,"bm25DurationMs":0,"commitDurationMs":16.4,"totalDurationMs":16691,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 16613 ms, chunk: 45 ms, commit: 16 ms","ℹ️ total wall time: 16691 ms","ℹ️ throughput: 4.0 chunks/s, 0.7 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)"],"meta":{"timestamp":"2026-09-03T01:14:35.402Z","chromium":{"executablePath":"playwright-bundled","version":"151.0.7922.34","args":["--no-sandbox","--disable-dev-shm-usage"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
{"date":"2026-09-03T01:15:11.620Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"fedora-desktop"},"git":{"commit":"a77c670","dirty":false},"benchDevice":"wasm","benchFiles":12,"phase":"measured","rep":2,"adapter":null,"actualDevice":"wasm","result":{"mode":"run","benchDevice":"wasm","requestedDevice":"wasm","actualDevice":"wasm","dtype":"q4","adapter":null,"resolvedReason":null,"resolvedBackend":{"device":"wasm","requested":"auto","reason":null,"adapter":null},"webgpuError":null,"coldStartMs":1138.9,"warmupMs":null,"warmupSkipped":false,"wallClockMs":16592.5,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":0.72,"chunksPerSec":4.04,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":10766,"paceWaitMs":1.9,"embedBatchLatencyMs":{"n":28,"min":102.39999999850988,"max":839.3999999985099,"mean":588.8892857139664,"p50":632.2000000029802,"p95":777.6000000014901},"embedDurationMs":16516.5,"chunkDurationMs":42.4,"bm25DurationMs":0,"commitDurationMs":17.6,"totalDurationMs":16591.8,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 16516 ms, chunk: 42 ms, commit: 18 ms","ℹ️ total wall time: 16592 ms","ℹ️ throughput: 4.0 chunks/s, 0.7 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)"],"meta":{"timestamp":"2026-09-03T01:14:53.734Z","chromium":{"executablePath":"playwright-bundled","version":"151.0.7922.34","args":["--no-sandbox","--disable-dev-shm-usage"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
{"date":"2026-09-03T01:15:29.829Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"fedora-desktop"},"git":{"commit":"a77c670","dirty":false},"benchDevice":"wasm","benchFiles":12,"phase":"measured","rep":3,"adapter":null,"actualDevice":"wasm","result":{"mode":"run","benchDevice":"wasm","requestedDevice":"wasm","actualDevice":"wasm","dtype":"q4","adapter":null,"resolvedReason":null,"resolvedBackend":{"device":"wasm","requested":"auto","reason":null,"adapter":null},"webgpuError":null,"coldStartMs":1160,"warmupMs":null,"warmupSkipped":false,"wallClockMs":16506.7,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":0.73,"chunksPerSec":4.06,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":10766,"paceWaitMs":1.5,"embedBatchLatencyMs":{"n":28,"min":96.19999999552965,"max":839.5,"mean":586.3357142840645,"p50":621.9000000059605,"p95":777.5999999940395},"embedDurationMs":16444,"chunkDurationMs":42.4,"bm25DurationMs":0,"commitDurationMs":17,"totalDurationMs":16506.3,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 16444 ms, chunk: 42 ms, commit: 17 ms","ℹ️ total wall time: 16506 ms","ℹ️ throughput: 4.1 chunks/s, 0.7 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)"],"meta":{"timestamp":"2026-09-03T01:15:12.018Z","chromium":{"executablePath":"playwright-bundled","version":"151.0.7922.34","args":["--no-sandbox","--disable-dev-shm-usage"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
{"date":"2026-09-03T01:15:46.863Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"fedora-desktop"},"git":{"commit":"a77c670","dirty":false},"benchDevice":"webgpu","benchFiles":12,"phase":"measured","rep":1,"adapter":{"vendor":"amd","architecture":"rdna-3","description":"","classification":"real"},"actualDevice":"webgpu","result":{"mode":"run","benchDevice":"webgpu","requestedDevice":"auto","actualDevice":"webgpu","dtype":"q4","adapter":{"vendor":"amd","architecture":"rdna-3","description":"","classification":"real"},"resolvedReason":null,"resolvedBackend":{"device":"webgpu","requested":"auto","reason":null,"adapter":{"vendor":"amd","architecture":"rdna-3","description":""}},"webgpuError":null,"coldStartMs":1546.8,"warmupMs":null,"warmupSkipped":true,"wallClockMs":1616.7,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":22.08,"chunksPerSec":123.3,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":12048,"paceWaitMs":1,"embedBatchLatencyMs":{"n":28,"min":8.800000004470348,"max":28.399999998509884,"mean":15.935714286619,"p50":14.800000004470348,"p95":24.200000002980232},"embedDurationMs":467.8,"chunkDurationMs":43.5,"bm25DurationMs":0,"commitDurationMs":15.8,"totalDurationMs":543.4,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 468 ms, chunk: 43 ms, commit: 16 ms","ℹ️ total wall time: 543 ms","ℹ️ throughput: 123.3 chunks/s, 22.1 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.3 MB on disk (IDB)","🧹 released WebGPU buffer pool post-index (1073 ms) — reclaims the indexing high-water-mark to the query floor"],"meta":{"timestamp":"2026-09-03T01:15:43.563Z","chromium":{"executablePath":"playwright-bundled","version":"151.0.7922.34","args":["--no-sandbox","--disable-dev-shm-usage","--enable-features=Vulkan,VulkanFromANGLE","--use-angle=vulkan","--enable-unsafe-webgpu","--ignore-gpu-blocklist"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
{"date":"2026-09-03T01:15:50.515Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"fedora-desktop"},"git":{"commit":"a77c670","dirty":false},"benchDevice":"webgpu","benchFiles":12,"phase":"measured","rep":2,"adapter":{"vendor":"amd","architecture":"rdna-3","description":"","classification":"real"},"actualDevice":"webgpu","result":{"mode":"run","benchDevice":"webgpu","requestedDevice":"auto","actualDevice":"webgpu","dtype":"q4","adapter":{"vendor":"amd","architecture":"rdna-3","description":"","classification":"real"},"resolvedReason":null,"resolvedBackend":{"device":"webgpu","requested":"auto","reason":null,"adapter":{"vendor":"amd","architecture":"rdna-3","description":""}},"webgpuError":null,"coldStartMs":1547.5,"warmupMs":null,"warmupSkipped":true,"wallClockMs":1563.6,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":20.79,"chunksPerSec":116.1,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":12048,"paceWaitMs":0.8,"embedBatchLatencyMs":{"n":28,"min":11.799999997019768,"max":29.799999997019768,"mean":17.228571428784303,"p50":15.5,"p95":27.5},"embedDurationMs":509.4,"chunkDurationMs":42.6,"bm25DurationMs":0,"commitDurationMs":19.7,"totalDurationMs":577.1,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 509 ms, chunk: 43 ms, commit: 20 ms","ℹ️ total wall time: 577 ms","ℹ️ throughput: 116.1 chunks/s, 20.8 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)","🧹 released WebGPU buffer pool post-index (986 ms) — reclaims the indexing high-water-mark to the query floor"],"meta":{"timestamp":"2026-09-03T01:15:47.265Z","chromium":{"executablePath":"playwright-bundled","version":"151.0.7922.34","args":["--no-sandbox","--disable-dev-shm-usage","--enable-features=Vulkan,VulkanFromANGLE","--use-angle=vulkan","--enable-unsafe-webgpu","--ignore-gpu-blocklist"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
{"date":"2026-09-03T01:15:54.125Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"fedora-desktop"},"git":{"commit":"a77c670","dirty":false},"benchDevice":"webgpu","benchFiles":12,"phase":"measured","rep":3,"adapter":{"vendor":"amd","architecture":"rdna-3","description":"","classification":"real"},"actualDevice":"webgpu","result":{"mode":"run","benchDevice":"webgpu","requestedDevice":"auto","actualDevice":"webgpu","dtype":"q4","adapter":{"vendor":"amd","architecture":"rdna-3","description":"","classification":"real"},"resolvedReason":null,"resolvedBackend":{"device":"webgpu","requested":"auto","reason":null,"adapter":{"vendor":"amd","architecture":"rdna-3","description":""}},"webgpuError":null,"coldStartMs":1536.2,"warmupMs":null,"warmupSkipped":true,"wallClockMs":1547.8,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":21.59,"chunksPerSec":120.55,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":12048,"paceWaitMs":0.9,"embedBatchLatencyMs":{"n":28,"min":11.700000002980232,"max":29.399999998509884,"mean":15.89285714365542,"p50":15,"p95":21.100000001490116},"embedDurationMs":468,"chunkDurationMs":50.4,"bm25DurationMs":0,"commitDurationMs":16.7,"totalDurationMs":555.8,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 468 ms, chunk: 50 ms, commit: 17 ms","ℹ️ total wall time: 556 ms","ℹ️ throughput: 120.5 chunks/s, 21.6 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)","🧹 released WebGPU buffer pool post-index (991 ms) — reclaims the indexing high-water-mark to the query floor"],"meta":{"timestamp":"2026-09-03T01:15:50.906Z","chromium":{"executablePath":"playwright-bundled","version":"151.0.7922.34","args":["--no-sandbox","--disable-dev-shm-usage","--enable-features=Vulkan,VulkanFromANGLE","--use-angle=vulkan","--enable-unsafe-webgpu","--ignore-gpu-blocklist"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
```

### Raw ndjson lines — container (measured runs)
```
{"date":"2026-09-03T01:23:40.827Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"d718b6eac38b"},"git":{"commit":"9dfbb21","dirty":false},"benchDevice":"wasm","benchFiles":12,"phase":"measured","rep":1,"adapter":null,"actualDevice":"wasm","result":{"mode":"run","benchDevice":"wasm","requestedDevice":"wasm","actualDevice":"wasm","dtype":"q4","adapter":null,"resolvedReason":null,"resolvedBackend":{"device":"wasm","requested":"auto","reason":null,"adapter":null},"webgpuError":null,"coldStartMs":1093.1,"warmupMs":null,"warmupSkipped":false,"wallClockMs":16734.9,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":0.72,"chunksPerSec":4,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":10766,"paceWaitMs":2.4,"embedBatchLatencyMs":{"n":28,"min":95.5,"max":838.6000000014901,"mean":593.589285714818,"p50":632.2999999970198,"p95":783.9000000059605},"embedDurationMs":16650.5,"chunkDurationMs":49.8,"bm25DurationMs":0,"commitDurationMs":17.5,"totalDurationMs":16734.2,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 16651 ms, chunk: 50 ms, commit: 17 ms","ℹ️ total wall time: 16734 ms","ℹ️ throughput: 4.0 chunks/s, 0.7 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)"],"meta":{"timestamp":"2026-09-03T01:23:22.808Z","chromium":{"executablePath":"/usr/bin/chromium","version":"151.0.7922.137","args":["--no-sandbox","--disable-dev-shm-usage"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
{"date":"2026-09-03T01:23:59.601Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"d718b6eac38b"},"git":{"commit":"9dfbb21","dirty":false},"benchDevice":"wasm","benchFiles":12,"phase":"measured","rep":2,"adapter":null,"actualDevice":"wasm","result":{"mode":"run","benchDevice":"wasm","requestedDevice":"wasm","actualDevice":"wasm","dtype":"q4","adapter":null,"resolvedReason":null,"resolvedBackend":{"device":"wasm","requested":"auto","reason":null,"adapter":null},"webgpuError":null,"coldStartMs":1175.3,"warmupMs":null,"warmupSkipped":false,"wallClockMs":16930.3,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":0.71,"chunksPerSec":3.96,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":10766,"paceWaitMs":1.9,"embedBatchLatencyMs":{"n":28,"min":97.60000000149012,"max":900.7999999970198,"mean":600.4607142856611,"p50":627.9000000059605,"p95":796.1999999955297},"embedDurationMs":16843.5,"chunkDurationMs":54.7,"bm25DurationMs":0,"commitDurationMs":17.6,"totalDurationMs":16929.8,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 16844 ms, chunk: 55 ms, commit: 18 ms","ℹ️ total wall time: 16930 ms","ℹ️ throughput: 4.0 chunks/s, 0.7 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)"],"meta":{"timestamp":"2026-09-03T01:23:41.286Z","chromium":{"executablePath":"/usr/bin/chromium","version":"151.0.7922.137","args":["--no-sandbox","--disable-dev-shm-usage"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
{"date":"2026-09-03T01:24:17.770Z","machine":{"cpu":"AMD RYZEN AI MAX+ 395 w/ Radeon 8060S","cores":32,"platform":"linux","arch":"x64","hostname":"d718b6eac38b"},"git":{"commit":"9dfbb21","dirty":false},"benchDevice":"wasm","benchFiles":12,"phase":"measured","rep":3,"adapter":null,"actualDevice":"wasm","result":{"mode":"run","benchDevice":"wasm","requestedDevice":"wasm","actualDevice":"wasm","dtype":"q4","adapter":null,"resolvedReason":null,"resolvedBackend":{"device":"wasm","requested":"auto","reason":null,"adapter":null},"webgpuError":null,"coldStartMs":1092.1,"warmupMs":null,"warmupSkipped":false,"wallClockMs":16419.2,"files":12,"filesCommitted":12,"chunks":67,"vectors":67,"filesPerSec":0.73,"chunksPerSec":4.08,"embedDispatches":28,"effectiveBatch":2.39,"paddedTokens":10766,"paceWaitMs":4.1,"embedBatchLatencyMs":{"n":28,"min":95.60000000149012,"max":832.8000000044703,"mean":582.4928571430167,"p50":618,"p95":774.6000000014901},"embedDurationMs":16344.7,"chunkDurationMs":49.3,"bm25DurationMs":0,"commitDurationMs":21.1,"totalDurationMs":16418.7,"filesSkippedError":0,"indexPass":true,"checks":["✅ indexed 12 files → 67 chunks → 67 vectors","ℹ️ embed: 16345 ms, chunk: 49 ms, commit: 21 ms","ℹ️ total wall time: 16419 ms","ℹ️ throughput: 4.1 chunks/s, 0.7 files/s","ℹ️ embed: 28 dispatches, effective batch ≈ 2.4 (budget 512, max 8)","ℹ️ dense background: 67 vecs < 200 — calibration off","ℹ️ token budget: 1 chunk(s) re-packed to ≤512 tokens","ℹ️ storage delta: +0.2 MB on disk (IDB)"],"meta":{"timestamp":"2026-09-03T01:24:00.070Z","chromium":{"executablePath":"/usr/bin/chromium","version":"151.0.7922.137","args":["--no-sandbox","--disable-dev-shm-usage"]},"cacheDir":"/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.bench-cache","model":"tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX","benchFiles":12,"documentHidden":false}}}
```

## Notes

**2026-09-03T01:27:58Z**

__READY_AS_IS__: docs-only branch; table medians and code-level claims re-verified against raw ndjson and src/search.ts; only fix was two cherry-picked figures (buffer-pool release ≈1000 ms not 1070, WebGPU paddedTokens 12048), typecheck+tests pass
