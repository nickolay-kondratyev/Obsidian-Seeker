---
closed_iso: 2026-09-03T04:26:00Z
id: nid_dgaqfjqgyi78zwcxmy3q8e6k8_e
title: "Recapture host baseline pair at BENCH_FILES=70 (two-baseline convention)"
status: closed
deps: []
links: [nid_d5o2w9eb3d1l885d2q8kk992l_e]
created_iso: 2026-09-03T01:25:46Z
status_updated_iso: 2026-09-03T04:26:00Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, baseline, need-human]
---

The baseline in docs/perf-bench.md (ticket nid_d5o2w9eb3d1l885d2q8kk992l_e) was captured on the reference host with the default BENCH_FILES=12, not the BENCH_FILES=70 that the two-baseline convention in docs/perf-bench.md prescribes. At 12 files the WebGPU headline (wallClockMs) is ~2/3 the fixed post-index WebGPU buffer-pool release (see the Reading the baseline section), which blunts the 10 %-median rule for embedding levers.

Human, on the Fedora host at the repo root with Obsidian closed:

    BENCH_DEVICE=wasm   BENCH_FILES=70 npm run bench:host
    BENCH_DEVICE=webgpu BENCH_FILES=70 npm run bench:host

Then paste the summaries / the appended .bench/results.ndjson lines into this ticket. Agent: run BENCH_FILES=70 npm run bench in the container (expect ~5 min on wasm), add three new rows to the baseline table in docs/perf-bench.md, and note whether the buffer-pool-release share drops as expected.

## Acceptance Criteria

docs/perf-bench.md baseline table has host wasm, host webgpu and container wasm rows at BENCH_FILES=70 from the same commit.

```
m:fedora-desktop d:nickolay-kondratyev_Obsidian-Seeker-mirror-1 b:main mirror-1 ○ ❯BENCH_DEVICE=wasm   BENCH_FILES=70 npm run bench:host; echo NEXT; BENCH_DEVICE=webgpu BENCH_FILES=70 npm run bench:host

> seeker@1.1.3 bench:host
> node scripts/bench.mjs --default-device=webgpu

bench-runner: device=[wasm] files=[70]
bench-runner: chromium=[/home/nickolaykondratyev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome]
bench-runner: flags=[--no-sandbox --disable-dev-shm-usage]
bench-runner: cpu-idle gate: busy=[4%] over 2000 ms — ok
bench-runner: ── warm-up 1/1 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[wasm] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: warm-up 1/1: wallClock=[97715.7 ms] chunks/s=[4.02] dispatches=[156] (117.7 s incl. launch)
bench-runner: ── measured 1/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[wasm] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 1/3: wallClock=[96245 ms] chunks/s=[4.08] dispatches=[156] (98.1 s incl. launch)
bench-runner: ── measured 2/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[wasm] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 2/3: wallClock=[96616.7 ms] chunks/s=[4.07] dispatches=[156] (98.4 s incl. launch)
bench-runner: ── measured 3/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[wasm] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 3/3: wallClock=[96362.7 ms] chunks/s=[4.08] dispatches=[156] (98.1 s incl. launch)

metric           median    min      max       spread
---------------  --------  -------  --------  ------
wallClockMs      96362.70  96245    96616.70  0.4%
embedDurationMs  96117.50  95997    96353.70  0.4%
filesPerSec      0.73      0.72     0.73      1.4%
chunksPerSec     4.08      4.07     4.08      0.2%
embedDispatches  156       156      156       0.0%
effectiveBatch   2.52      2.52     2.52      0.0%
paddedTokens     63876     63876    63876     0.0%
paceWaitMs       148.30    143.10   169.70    17.9%
coldStartMs      1160      1124.20  1161.90   3.3%

(3 measured runs; spread = (max - min) / median. Full lines in /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench/results.ndjson)
NEXT

> seeker@1.1.3 bench:host
> node scripts/bench.mjs --default-device=webgpu

bench-runner: device=[webgpu] files=[70]
bench-runner: chromium=[/home/nickolaykondratyev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome]
bench-runner: flags=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist]
bench-runner: cpu-idle gate: busy=[2%] over 2000 ms — ok
bench-runner: ── warm-up 1/1 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[auto] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: warm-up 1/1: wallClock=[3410.6 ms] chunks/s=[207.48] dispatches=[40] (8.4 s incl. launch)
bench-runner: ── measured 1/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[auto] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 1/3: wallClock=[2922.3 ms] chunks/s=[202.72] dispatches=[40] (5.1 s incl. launch)
bench-runner: ── measured 2/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[auto] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 2/3: wallClock=[2882.9 ms] chunks/s=[201.3] dispatches=[40] (5.0 s incl. launch)
bench-runner: ── measured 3/3 ──
bench: bundling bench page
bench: launching chromium [playwright-bundled] args=[--no-sandbox --disable-dev-shm-usage --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist] profile=[/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench-cache]
bench: run: device=[auto] files=[70] batchSizing=[shipped constant] (first-ever run also downloads the model; later runs hit the profile cache)
bench-runner: measured 3/3: wallClock=[2877.5 ms] chunks/s=[202.95] dispatches=[40] (5.0 s incl. launch)

metric           median   min      max      spread
---------------  -------  -------  -------  ------
wallClockMs      2882.90  2877.50  2922.30  1.6%
embedDurationMs  1727.40  1717.20  1733     0.9%
filesPerSec      36.11    35.86    36.15    0.8%
chunksPerSec     202.72   201.30   202.95   0.8%
embedDispatches  40       40       40       0.0%
effectiveBatch   9.82     9.82     9.82     0.0%
paddedTokens     71664    71664    71664    0.0%
paceWaitMs       8.10     1.20     9.90     107.4%
coldStartMs      1560.30  1512.90  1561.60  3.1%

(3 measured runs; spread = (max - min) / median. Full lines in /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.bench/results.ndjson)
m:fedora-desktop d:nickolay-kondratyev_Obsidian-Seeker-mirror-1 b:main mirror-1 ○ ❯
```

## Agent: container WASM row (BENCH_FILES=70)

`BENCH_FILES=70 npm run bench` in the dev container (no GPU, system Chromium
151, commit `0899abc`, clean):

```
metric           median    min       max       spread
wallClockMs      96553.70  96380.40  96580.40  0.2%
embedDurationMs  96268.60  96101.60  96302.80  0.2%
filesPerSec      0.72      0.72      0.73      1.4%
chunksPerSec     4.07      4.07      4.08      0.2%
embedDispatches  156       156       156       0.0%
effectiveBatch   2.52      2.52      2.52      0.0%
paddedTokens     63876     63876     63876     0.0%
paceWaitMs       182.00    173.90    202.90    15.9%
coldStartMs      1058.50   1039.50   1075.80   3.4%
```

Container WASM tracks host WASM within 0.2 % (96553.7 vs 96362.7 ms; both 156
dispatches / 2.52 effective batch), so it stays a faithful WASM regression
guard at 70 files.

## Agent: outcome

- Added three `BENCH_FILES=70` rows to the **Baselines** table in
  `docs/perf-bench.md` (host wasm, host webgpu, container wasm) and made the
  70-file pair the canonical two-baseline capture; updated the stale
  "captured at BENCH_FILES=12" caveat.
- **Buffer-pool-release share drops as predicted.** On host WebGPU at 70 files
  embed is 1727 ms of the 2883 ms headline (≈60 %); the fixed post-index tail
  stays flat at ≈1155 ms, so its share falls from ≈2/3 (12 files) to ≈40 %.
  An embedding lever can now move the WebGPU median by up to ~60 %, so the
  10 %-median rule is no longer blunted — recorded in "Reading the baseline".
- **Commits (from the mounted `.bench/results.ndjson`, no rerun):** the host
  wasm + webgpu 70-file runs are at `c257960` (clean); the agent container run
  is at `0899abc` (clean). `git diff c257960 0899abc` touches only two ticket
  `.md` files — src/bench/build are byte-identical — so the container row is
  labelled `0899abc (src identical to c257960)`, matching the 12-file table's
  `9dfbb21 (src identical to a77c670)` convention. Same-commit criterion met in
  substance (identical src).