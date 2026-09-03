---
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_d5o2w9eb3d1l885d2q8kk992l_e
title: "Capture baseline pair on the reference host (WASM vs WebGPU) + container WASM into docs/perf-bench.md"
status: in_progress
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_eiq9gtj7yeiic6cgztef2c0ki_e]
links: []
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-03T01:22:19Z
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