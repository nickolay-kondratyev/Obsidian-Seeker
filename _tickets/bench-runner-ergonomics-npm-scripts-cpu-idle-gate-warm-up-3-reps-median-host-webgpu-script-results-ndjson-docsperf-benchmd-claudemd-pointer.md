---
id: nid_eiq9gtj7yeiic6cgztef2c0ki_e
title: "Bench runner ergonomics: npm scripts, CPU-idle gate, warm-up + 3 reps median, host WebGPU script, results ndjson, docs/perf-bench.md + CLAUDE.md pointer"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_pt77674z2iel2w8rmdga3bvkb_e]
links: []
created_iso: 2026-09-02T22:54:54Z
status_updated_iso: 2026-09-02T22:54:54Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, docs]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on the bench harness.

## What
1. `scripts/bench.mjs` (Node, no deps): (a) CPU-idle gate — sample `/proc/stat` (Linux) or `os.cpus()` deltas (portable) for ~2 s; if busy > 20% print a plain-language abort message and exit non-zero unless `BENCH_FORCE=1` (named constants for the threshold and window); (b) run 1 warm-up + 3 measured harness runs (`BENCH_REPS` override), parse the JSON lines, report median + min/max spread per metric; (c) append one JSON line per run to git-ignored `.bench/results.ndjson` with machine info (`os.cpus()[0].model`, platform, `git rev-parse --short HEAD`, dirty flag, date, BENCH_DEVICE, BENCH_FILES, adapter info from the harness output).
2. npm scripts: `bench` (container/default: wasm), `bench:host` (webgpu with the verified Linux flags; on macOS no flags), `bench:setup` (installs the Playwright chromium once where no system Chromium exists). `bench:host` must print, before running, the exact Chromium flags used.
3. `docs/perf-bench.md`: how to run (container vs host), what the numbers mean, the 10%-median-with-spread-below rule for accepting a lever, the two-baseline convention (host WASM and host WebGPU), and an empty baseline table (machine | date | commit | device | files | wall-clock | files/s | chunks/s | dispatches | eff. batch). The baseline-capture ticket fills it.
4. `CLAUDE.md` (root): one succinct line under Commands pointing to `docs/perf-bench.md` as THE indexing-performance bench to run when touching `src/search.ts` batching, `src/pacer.ts`, or `src/iframe-runner.ts` load/warmup.

## Files
- `scripts/bench.mjs` (new), `package.json`, `docs/perf-bench.md` (new), `CLAUDE.md`, `.gitignore`.
- Unit test for the gate math and the median/spread reducer (`scripts/bench.test.mjs` or under `bench/`), one assert per test.

## Acceptance Criteria

npm run bench works in the container (gate + reps + ndjson); npm run bench:host documented for Fedora/macOS; docs/perf-bench.md exists and CLAUDE.md links it; reducer/gate unit tests pass.

