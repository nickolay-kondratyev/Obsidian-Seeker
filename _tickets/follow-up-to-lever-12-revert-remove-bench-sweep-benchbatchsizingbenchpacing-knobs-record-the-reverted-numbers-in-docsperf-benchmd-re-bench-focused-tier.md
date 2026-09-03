---
closed_iso: 2026-09-03T17:32:59Z
session_ids: [{"a": "claude", "type": "execution", "id": "0296c7b9-0f78-4b0f-9b44-34ff41f30932"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_1q9es6a8xioobppnlxqramswx_e
title: "Follow-up to lever 1+2 revert: remove bench sweep + BENCH_BATCH_SIZING/BENCH_PACING knobs, record the reverted numbers in docs/perf-bench.md"
status: closed
deps: [nid_wzsj2sawjazdxakqi8czjh0sc_e]
links: []
created_iso: 2026-09-03T17:09:41Z
status_updated_iso: 2026-09-03T17:32:59Z
type: chore
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, docs, simplify]
---

Depends on the src/ revert ticket nid_wzsj2sawjazdxakqi8czjh0sc_e (levers 1+2 → one base batch tier). That ticket strips only the two override calls in `bench/harness/page.ts` so `npm run bench` keeps working; this ticket removes everything else in the bench/scripts/docs surface that existed solely to tune or measure the now-removed tiers.

REMOVE:
- `scripts/bench-sweep.mjs`, `scripts/bench-sweep-report.mjs`, `scripts/bench-sweep-report.test.mjs`, `bench/harness/batch-sizing-spec.mjs` — the desktop-WebGPU sizing sweep (lever 1). There is no longer a sizing to sweep.
- `package.json`: the `bench:sweep` script. Keep `bench`, `bench:host`, `bench:setup`.
- `bench/harness/run.mjs` + `scripts/bench.mjs`: the `BENCH_BATCH_SIZING` and `BENCH_PACING` env vars, their header docs, and any result fields that only existed for them (e.g. the pacing tier tag on ndjson rows). Keep `BENCH_DEVICE`, `BENCH_FILES`, `BENCH_REPS`, `BENCH_FORCE`, `BENCH_CHROMIUM`, the CPU-idle gate, the real-adapter gate, and the two-baseline convention.
- `bench/harness/webgpu-software.test.ts` is lever 0 (software-adapter rejection) — KEEP.

DOCS (`docs/perf-bench.md`):
- Delete the "Lever 1" and "Lever 2" how-to sections and the `BENCH_BATCH_SIZING` / `BENCH_PACING` rows in the env-var table.
- Do NOT delete the measured numbers. Add a short "Reverted levers" record (same shape as the existing dispatch-overlap revert entry from commit 2a59b55): lever 1 sweep result (2048/32: wall −17.5%, embed −23.3%, dispatches 156→40, p95 17→56 ms on Radeon 8060S, 70 files), lever 2 focused/unfocused rows, and the reason for the revert (unfocused-only win, not make-or-break, complexity of the sizing→warmup-grid→fingerprint invariant + focus polling + a user setting outweighed it). This is the record a future re-decision reads instead of re-running the experiment.
- `CLAUDE.md` (root) Commands section: drop the `bench:sweep` sentence.

SMOKE CHECK (fully automatable — no human / no GPU needed):
- Container `npm run bench` (wasm) must still run to completion after the harness edits; record its row in `docs/perf-bench.md`.
- No host GPU re-bench is required (decision 2026-09-03: this is a cleanup). The focused desktop path was byte-identical before and after the revert, so a GPU confirmation adds little; `npm run bench:host` remains available on demand if anyone wants the number later.

## Acceptance Criteria

- `npm run bench:sweep` no longer exists; `grep -rn "BENCH_BATCH_SIZING\|BENCH_PACING\|bench-sweep\|batch-sizing-spec" . --exclude-dir=node_modules --exclude-dir=.git` returns nothing.
- `npm run test` green (includes the removed sweep-report test being gone, not skipped).
- `docs/perf-bench.md` has a "Reverted levers" record carrying the measured lever 1/2 numbers and the revert reason; no lever 1/2 how-to remains.
- Container `npm run bench` (wasm) runs to completion post-cleanup; its row appended to `docs/perf-bench.md`.
- `change_log` entry written.


## Resolution (2026-09-03, commit 31129c9)

Done as specified; no deviations.

- **Removed**: `scripts/bench-sweep.mjs`, `scripts/bench-sweep-report.mjs` + `.test.mjs`, `bench/harness/batch-sizing-spec.mjs` + its `.test.mjs` (not listed in the spec, but it only tested the removed module), `bench:sweep` in `package.json`, the `BENCH_BATCH_SIZING` / `BENCH_PACING` env vars and header docs in `bench/harness/run.mjs`, the `BenchOptions` / `BenchPacing` types and `opts` argument in `bench/harness/page.ts`, the `parsePacing` use in `scripts/bench.mjs`. ndjson rows no longer carry `pacing`, `warmupPasses`, `batchSizingOverride`.
- **Kept on purpose**: `batchSizing` on ndjson rows (self-describing row of the shipped constant, not knob-specific) and `embedRecycles` (general ORT-Web overflow diagnostic). `warmupPassCount` in `src/batch-sizing.ts` still has its own test and a doc reference in `src/iframe-runner.ts`, so it stays.
- **Docs**: `docs/perf-bench.md` lever 1 + lever 2 how-to sections replaced by a "Reverted levers" section (lever 1 sweep table, lever 2 three-row table, revert reason, what stayed, when to retry). Env-var rows dropped; production-settings paragraph updated to one `BATCH_SIZING`. Root `CLAUDE.md` `bench:sweep` sentence dropped.
- **Smoke check**: container `npm run bench` (wasm, 12 files, 3 reps) ran to completion after the edits: wall-clock median 16684.3 ms (spread 1.4 %), 28 dispatches, eff. batch 2.39, paddedTokens 10766 — identical to the 12-file container baseline. Row appended to the Baselines table. `npm run typecheck` and `npm run test` green (74 files / 1268 tests). No host GPU re-bench, per the ticket's decision.
- **Acceptance grep**: clean for all code and docs. The literal knob names still appear in `_tickets/` and `_change_log/` history files, which are records and were left untouched.
- `change_log` entry written.
