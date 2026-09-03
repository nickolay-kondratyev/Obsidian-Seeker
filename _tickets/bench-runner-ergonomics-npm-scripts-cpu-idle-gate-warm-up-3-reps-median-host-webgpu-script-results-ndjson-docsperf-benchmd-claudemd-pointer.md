---
closed_iso: 2026-09-03T00:22:42Z
session_ids: [{"a": "claude", "type": "execution", "id": "e36b58e5-ab4d-45d7-82b4-32ea36d57582"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_eiq9gtj7yeiic6cgztef2c0ki_e
title: "Bench runner ergonomics: npm scripts, CPU-idle gate, warm-up + 3 reps median, host WebGPU script, results ndjson, docs/perf-bench.md + CLAUDE.md pointer"
status: closed
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_pt77674z2iel2w8rmdga3bvkb_e]
links: []
created_iso: 2026-09-02T22:54:54Z
status_updated_iso: 2026-09-03T00:22:42Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, docs]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on the bench harness.

## What
1. `scripts/bench.mjs` (Node, no deps): (a) CPU-idle gate — sample `/proc/stat` (Linux) or `os.cpus()` deltas (portable) for ~2 s; if busy > 20% print a plain-language abort message and exit non-zero unless `BENCH_FORCE=1` (named constants for the threshold and window); (b) run 1 warm-up + 3 measured harness runs by spawning `node bench/harness/run.mjs` (harness ticket; standalone Playwright script) with `BENCH_REPS` override, parse the one JSON object each run prints, report median + min/max spread per metric; (c) append one JSON line per run to git-ignored `.bench/results.ndjson` with machine info (`os.cpus()[0].model`, platform, `git rev-parse --short HEAD`, dirty flag, date, BENCH_DEVICE, BENCH_FILES, adapter info from the harness output).
2. npm scripts: `bench` (container/default: `BENCH_DEVICE=wasm`, system Chromium at `/usr/bin/chromium`), `bench:host` (default `BENCH_DEVICE=webgpu`; the harness adds the verified Linux flags on Linux and none on macOS — flags live in ONE place, the harness, not duplicated here), `bench:setup` (`npx playwright install chromium`, once, where no system Chromium exists). `bench:host` must print, before running, the exact Chromium flags and executable used (the harness exposes them, e.g. `--print-launch`). The baseline ticket runs `bench:host` with `BENCH_DEVICE=wasm` and `webgpu` in turn, so `BENCH_DEVICE` must override the script default.
3. `docs/perf-bench.md`: how to run (container vs host), what the numbers mean, the 10%-median-with-spread-below rule for accepting a lever, the two-baseline convention (host WASM and host WebGPU), and an empty baseline table (machine | date | commit | device | files | wall-clock | files/s | chunks/s | dispatches | eff. batch). The baseline-capture ticket fills it.
4. `CLAUDE.md` (root): one succinct line under Commands pointing to `docs/perf-bench.md` as THE indexing-performance bench to run when touching `src/search.ts` batching, `src/pacer.ts`, or `src/iframe-runner.ts` load/warmup.

## Files
- `scripts/bench.mjs` (new), `package.json`, `docs/perf-bench.md` (new), `CLAUDE.md`, `.gitignore`.
- Unit test for the gate math and the median/spread reducer (`scripts/bench.test.mjs` or under `bench/`), one assert per test.

## Acceptance Criteria

npm run bench works in the container (gate + reps + ndjson); npm run bench:host documented for Fedora/macOS; docs/perf-bench.md exists and CLAUDE.md links it; reducer/gate unit tests pass.


## RESOLUTION (2026-09-03, execution session)

Built and verified in the dev container. All acceptance criteria met.

**What lives where**
- `scripts/bench.mjs` — the runner (`npm run bench` / `bench:host`). Header documents the steps and env vars. Prints Chromium executable + flags (imported from the harness's `DEVICE_PROFILES` via `chromiumArgs()` / `resolveChromiumPath()`; bundled-Chromium path via `playwright-core`'s `chromium.executablePath()` — flags live only in the harness), runs the CPU-idle gate, spawns `bench/harness/run.mjs` 1 warm-up + `BENCH_REPS` (default 3) times, appends one line per run to `.bench/results.ndjson`, prints a median/min/max/spread table.
- `scripts/bench-math.mjs` — pure logic: `CpuSample` (`/proc/stat` or `os.cpus()` snapshot), `CpuGate.busyFraction/isTooBusy` (`CPU_GATE_WINDOW_MS = 2000`, `CPU_BUSY_THRESHOLD = 0.20`), `RunStats.median/spread/summarize`. Tested by `scripts/bench-math.test.mjs` (17 tests, one assert each; vitest's default include already matches `scripts/*.test.mjs`).
- `package.json`: `bench` = `node scripts/bench.mjs --default-device=wasm`, `bench:host` = `--default-device=webgpu`, `bench:setup` = `playwright-core install chromium`. `BENCH_DEVICE` in the env always wins over `--default-device` (verified), so the baseline ticket can run `BENCH_DEVICE=wasm npm run bench:host`.
- `docs/perf-bench.md` — how to run (container vs host), metric meanings, the 10%-median rule, two-baseline convention, empty baseline table. `CLAUDE.md` Commands section points to it.
- `.gitignore` already had `.bench/` and `.bench-cache/` from the harness ticket — nothing to add.

**Decisions made here (ticket left them open)**
- Script-default vs env override is done with a `--default-device=` CLI flag rather than `${BENCH_DEVICE:-webgpu}` shell syntax: explicit, portable, and unknown flags fail loudly.
- Warm-up lines ARE written to the ndjson, tagged `phase: "warmup"`; the summary uses measured runs only. Each line embeds the full harness JSON under `result` so nothing is lost.
- Gate abort exit code is 2 (distinct from harness failure = 1). Gate math is exercised before any Chromium launch.
- `warmupMs` (null on wasm) is skipped by the reducer instead of reported as NaN.

**Harness fix made along the way (bench/harness/page.ts)**
The first full 12-file run failed: `deleteDb` rejected on IndexedDB's `blocked` event. `blocked` fires when the just-closed store connection still has the fire-and-forget `persistBm25` transaction in flight; the delete then completes normally once it ends. `onblocked` now logs and keeps waiting for `success`. The 1-file smoke run never hit this (timing). The remaining stderr warning `[seek] BM25 persist failed ... IndexStore not opened` is benign noise; follow-up ticket filed (see note in .tmp/tk.txt output / `ticket ls`).

**Verified in the container**
- `npm run bench` (default 12 files, 1+3): gate ok at 3% busy, all 4 harness runs succeeded, median wallClock 16 568 ms with 0.5% spread, 4.04 chunks/s, 28 dispatches, eff. batch 2.39; 4 lines in `.bench/results.ndjson` with cpu model, cores, platform, commit, dirty flag, date, device, files, adapter.
- Gate abort: under a 32-process CPU spin the runner printed the plain-language message and exited 2 before launching anything.
- `BENCH_DEVICE=webgpu-absent node scripts/bench.mjs --default-device=webgpu` printed `device=[webgpu-absent]` (env override works); `--bogus` fails with usage.
- `npx playwright-core install --help` works, so `bench:setup` is valid.
- `npm run typecheck` clean; `npm run test` 70 files / 1242 tests green (incl. the 17 new).
- `bench:host` real-GPU path is host-only and NOT run here; the baseline ticket exercises it.
