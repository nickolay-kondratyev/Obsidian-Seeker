---
closed_iso: 2026-09-03T00:26:51Z
session_ids: [{"a": "claude", "type": "execution", "id": "0398d4fe-4a03-45ab-b4da-1f725d3f325e"}, {"a": "claude", "type": "review", "id": "d30005aa-34be-42b4-86ae-16bc90d14628"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_ao3yiodwpuanpxzcuyppja2w0_e
title: "Bench test: software-WebGPU (SwiftShader) adapter is rejected and lands on WASM (BENCH_DEVICE=webgpu-software)"
status: closed
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_yketo7yrdmkfdhbvywrzgux74_e, nid_pt77674z2iel2w8rmdga3bvkb_e]
links: []
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-03T00:26:51Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, webgpu, lever0, test]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on lever #0a (classifier + rejection) and the bench harness (its `BENCH_PROBE=1` load-only mode and the `webgpu-software` / `webgpu-absent` launch modes).

## What
A Node vitest file `bench/harness/webgpu-software.test.ts`, gated `describe.skipIf(!process.env.BENCH)` (vitest's default include already matches `bench/**/*.test.ts`, so the gate is what keeps it out of `npm run test`). Each test spawns the harness in probe mode with `child_process.spawnSync('node', ['bench/harness/run.mjs'], { env: { ...process.env, BENCH_PROBE: '1', BENCH_DEVICE: <mode> } })`, parses the JSON load entry from stdout, and asserts one thing per test:
- `BENCH_DEVICE=webgpu-software` (container Chromium 151 with `--enable-unsafe-webgpu` returns a SwiftShader adapter: `info.vendor === 'google'`, empty description, no `isFallbackAdapter` on the adapter object): (1) `actualDevice === 'wasm'`; (2) `reason` starts with `webgpu-fallback-rejected`; (3) adapter summary vendor is `google`.
- `BENCH_DEVICE=webgpu-absent` (no WebGPU flags): (4) `actualDevice === 'wasm'`; (5) `webgpuError` is one of `requestAdapter returned null` / `navigator.gpu not present` (whichever headless Chromium reports without flags is environment-dependent; accept both, never a software-rejection reason).
Print the raw JSON on assertion failure so a shape change is diagnosable.

## Why
Turns lever #0a's detection from "trust me" into an executable check on the exact software-adapter shape seen in the wild, reproducible in the container without a GPU.

## Files
- `bench/harness/webgpu-software.test.ts` (new); relies on `bench/harness/run.mjs` (harness ticket), `src/gpu-adapter.ts` + `src/platform.ts` (lever #0a).

## Acceptance Criteria

All five assertions pass in the container under BENCH=1; the file is skipped under plain npm run test.

## Resolution (2026-09-03)

Built `bench/harness/webgpu-software.test.ts`. Two `describe.skipIf(!process.env.BENCH)` blocks, one per mode; each spawns `bench/harness/run.mjs` once in `beforeAll` (`BENCH_PROBE=1`, `BENCH_DEVICE=<mode>`), parses the harness JSON, and holds the raw stdout as the assertion message so a shape change prints the whole object. One assertion per `it`.

Run: `BENCH=1 npx vitest run bench/harness/webgpu-software.test.ts` (5 passed, ~3.5 s warm in the container). Plain `npm run test` → 5 skipped. `npm run typecheck` clean (tsconfig already includes `bench/**/*.ts`).

Notes for the next reader:
- The field the ticket calls `reason` is `resolvedReason` in the harness top-level JSON (`summarizeLoad` in run.mjs); `webgpuError` carries the same string on the wasm-fallback path.
- Observed in container Chromium 151: `webgpu-software` → adapter `{vendor:'google', architecture:'swiftshader', description:''}`, classification `software`, reason `webgpu-fallback-rejected: google/`. `webgpu-absent` → `navigator.gpu` present but `requestAdapter returned null` (page warning "No available adapters."); the test also accepts `navigator.gpu not present` per the ticket.
- Both describes share `BENCH_PORT` 47331; they run sequentially within the one file, so no conflict. Do not run this file in parallel with `npm run bench`.
- Doc pointer added to `docs/perf-bench.md` §How to run.
