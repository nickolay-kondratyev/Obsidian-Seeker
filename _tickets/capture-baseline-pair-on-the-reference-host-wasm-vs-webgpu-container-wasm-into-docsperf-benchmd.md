---
id: nid_d5o2w9eb3d1l885d2q8kk992l_e
title: "Capture baseline pair on the reference host (WASM vs WebGPU) + container WASM into docs/perf-bench.md"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_eiq9gtj7yeiic6cgztef2c0ki_e]
links: []
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-02T22:54:55Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, need-human, baseline]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. NEEDS THE HUMAN to run scripts on the host (the agent container has no GPU). Depends on the runner-ergonomics ticket.

## Steps for the human (agent prepares exact commands and validates the output)
1. On the Fedora host, at the repo root, with Obsidian and other heavy apps closed: `npm run bench:setup` (once), then `BENCH_DEVICE=wasm npm run bench:host` and `BENCH_DEVICE=webgpu npm run bench:host`. Paste both summaries (or the appended `.bench/results.ndjson` lines) into this ticket.
2. Agent: run `npm run bench` in the container (WASM) and record it too.
3. Agent: fill the baseline table in `docs/perf-bench.md` (machine, date, commit, device, files, wall-clock, files/s, chunks/s, dispatches, effective batch) and add a one-paragraph reading of the numbers (e.g. pace-wait share, effective batch vs `ROLLING_MAX`). These are the reference numbers for the lever tickets; the host WebGPU row is THE reference.

Reference host (verified 2026-09-02): Fedora Linux, AMD Ryzen AI MAX+ 395 w/ Radeon 8060S iGPU (32 threads), Obsidian 1.13.7 Flatpak, Electron 43.3.0 / Chrome 150. Without flags `navigator.gpu` exists but `requestAdapter()` returns null -> plugin silently resolved to WASM while the setting said Force WebGPU. Verified working flags: `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`. Flatpak persists flags in `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf` (one flag per line).
Bench must use today's production settings (`ROLLING_BUDGET = 512`, `ROLLING_MAX = 8`, idle-gated pacer) — no lever changes may land before this ticket closes.

## Acceptance Criteria

docs/perf-bench.md baseline table has host WASM, host WebGPU and container WASM rows at the same commit; raw JSON lines pasted in this ticket.

