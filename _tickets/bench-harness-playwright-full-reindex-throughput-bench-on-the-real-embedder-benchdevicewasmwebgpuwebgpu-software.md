---
id: nid_pt77674z2iel2w8rmdga3bvkb_e
title: "Bench harness: Playwright full-reindex throughput bench on the REAL embedder (BENCH_DEVICE=wasm|webgpu|webgpu-software)"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_9xdumruajy1oru6nlz6g3y1ag_e]
links: []
created_iso: 2026-09-02T22:54:54Z
status_updated_iso: 2026-09-02T22:54:54Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, indexing, webgpu, decide]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on the corpus ticket. This is the measuring instrument every later lever ticket must use.

## DECISION NEEDED (tag `decide`): runner = standalone Playwright script, not vitest browser mode
The plan of record picked vitest browser mode (interview round 4, answer (a)). The ticket review on 2026-09-02 found that choice cannot honour two other round-4 decisions at the same time:
- The persistent Chromium profile (`.bench-cache/`) is a hard requirement, not a nicety: the model is ~100 MB (`src/model-registry.ts` header) plus transformers.js from jsdelivr. Re-downloading on every run blows the < 20 s container target and makes "1 warm-up + 3 reps" meaningless.
- vitest's playwright provider launches with `browserType.launch()` + `browser.newContext()`. Playwright's `launch()` REJECTS `--user-data-dir` in `args` (it throws and points you at `launchPersistentContext`). Only `chromium.launchPersistentContext(userDataDir, ...)` keeps the HTTP cache, the Cache API (where transformers.js stores model files) and Dawn's shader cache across runs.
Recommended and written up below: a standalone Playwright script (`bench/harness/run.mjs`) using `launchPersistentContext('.bench-cache/')` that loads an esbuild-bundled bench page. Same REAL stack, same JSON output, full control over Chromium flags, no CSP fights. vitest stays the runner for the corpus coverage test and for the software-WebGPU rejection test (which spawns this script in probe mode). The alternative that keeps vitest browser mode — a Vite-server caching proxy for jsdelivr + huggingface.co — needs the CDN/HF hosts made injectable in `src/iframe-runner.ts` (`CDN_URL` is a module const; transformers.js `env.remoteHost`), i.e. a production change for the sake of the bench. Not recommended. Human: approve the standalone script (or veto), then drop the `decide` tag.

## Goal
`node bench/harness/run.mjs` (the ergonomics ticket wraps it as `npm run bench` / `bench:host`) runs a FULL reindex of `bench/corpus/` through the production path inside a real Chromium page and prints ONE JSON object with stable keys: wall-clock ms, files, chunks, files/s, chunks/s, embed dispatches, effective batch, padded tokens, paceWaitMs, embedBatchLatencyMs p50/p95, resolved device + dtype + adapter info (+ `reason`, once lever #0a lands), coldStartMs, warmupMs. It is a script, so `npm run test` never touches it; any `*.test.ts` placed under `bench/harness/` MUST be gated `describe.skipIf(!process.env.BENCH)` (like `src/binary.test.ts:93`) because vitest's default include already matches `bench/**/*.test.ts`.

## How
- `bench/harness/run.mjs` (Node ESM, `playwright` devDependency): `chromium.launchPersistentContext(BENCH_CACHE_DIR, { headless: true, executablePath, args })`. Container: system Chromium at `/usr/bin/chromium` (`BENCH_CHROMIUM` env overrides the path), args `--no-sandbox --disable-dev-shm-usage`; there is no `/dev/dri` in the container, so real WebGPU is impossible there. Host: Playwright's bundled Chromium (installed once by `bench:setup`, ergonomics ticket) or a system one via `BENCH_CHROMIUM`.
- `bench/harness/page.ts` + `bench/harness/esbuild.mjs`: bundle the bench page from the REAL modules — `LocalEmbedder` (`src/embedder.ts`), `IframeRunner` (`src/iframe-runner.ts`, sandboxed srcdoc iframe; the child fetches jsdelivr + huggingface.co itself, both reachable from the container), `SearchOrchestrator` (`src/search.ts`), `IndexStore` (`src/index-store.ts`) — with esbuild `alias: { obsidian: './src/test-stubs/obsidian.ts' }` (the same stub vitest uses; `src/platform.ts` and `src/search.ts` import runtime values from it; extend the stub minimally, never touch production). Before the bundle runs, the page must define the Obsidian globals production code relies on: `window.activeWindow = window; window.activeDocument = document` (popout-window convention; mirror `src/test-stubs/test-setup.mts`). Serve page + bundle over a tiny local HTTP server (an `http://` origin, so IndexedDB and the sandboxed iframe behave as in Obsidian; avoid `file://`).
- `BENCH_DEVICE` (what Chromium flags + which `LocalEmbedder.load(requested, dtype, repo, revision)` device, see `src/embedder.ts` ~line 260 and the call in `src/main.ts` ~line 1041):
  - `wasm` (default): no GPU flags; load `'wasm'`.
  - `webgpu`: add `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist` (verified on the reference host: Fedora, Ryzen AI MAX+ 395 / Radeon 8060S); load `'auto'`; FAIL the run (non-zero exit, no result JSON) unless the load entry reports `actualDevice === 'webgpu'`; once lever #0a lands, additionally require adapter classification `real` (reason null).
  - `webgpu-software`: add `--enable-unsafe-webgpu` only (container Chromium then exposes a SwiftShader adapter, vendor `google`); load `'auto'`. Used by the rejection-test ticket; before #0a it loads as webgpu — expected.
  - `webgpu-absent`: no GPU flags; load `'auto'`. Expected to land on WASM (`webgpuError` = `requestAdapter returned null` or `navigator.gpu not present`). Used by the rejection-test ticket.
- `BENCH_PROBE=1`: load the model, print the load entry as JSON (`actualDevice`, `dtype`, `webgpuError`, adapter summary + `reason` after #0a, and `getResolvedBackend()` from `src/platform.ts` after #0a) and exit WITHOUT indexing. This is the hook the rejection-test ticket spawns.
- Corpus: read `bench/corpus/*.md` in Node, sorted path order, capped by `BENCH_FILES=N`; hand the array to the page via `page.evaluate(fn, files)`. Feed a `FakeVault`. NOTE: `src/test-harness/scenario.ts` imports `fake-indexeddb/auto` at module top, which would REPLACE the browser's real IndexedDB, so extracting `FakeVault` into an Obsidian-free, fake-indexeddb-free module (e.g. `src/test-harness/fake-vault.ts`, re-exported from `scenario.ts` so existing tests are untouched) is REQUIRED, not optional.
- REAL `IndexStore` on the browser's IndexedDB: fresh DB name per run, deleted afterwards. Model + CDN bytes live in `.bench-cache/` after the first run (git-ignored).
- Headline wall-clock wraps `SearchOrchestrator.reindexAll()` only (`src/search.ts` ~line 344; returns `IndexCompleteEntry` carrying `paceWaitMs`, `embedBatchLatencyMs`, dispatch/padded-token counters — see ~1431-1433 and ~1525-1534). Model load + warmup are reported separately (`coldStartMs`, `warmupMs` from the load entry) and excluded from the headline.
- Container target: pick the default `BENCH_FILES` so the WASM run is < 20 s once the cache is warm; document the chosen N in the script header and in `docs/perf-bench.md` (ergonomics ticket).

## Non-goals
- No production behavior change. No timing assertions anywhere. No CI wiring (CI has no GPU; the WASM run may be added later as opt-in).

## Files
- `bench/harness/run.mjs`, `bench/harness/page.ts`, `bench/harness/esbuild.mjs` (new); `package.json` devDependencies (`playwright`); `.gitignore` (+ `.bench-cache/`, `.bench/`); `src/test-stubs/obsidian.ts` (extend); `src/test-harness/fake-vault.ts` (extracted from `src/test-harness/scenario.ts`).

## Verify in the container before closing
`BENCH_DEVICE=wasm node bench/harness/run.mjs` completes on the corpus twice — the second run hits `.bench-cache/` and finishes in < 20 s — and prints the JSON; `BENCH_DEVICE=webgpu-software BENCH_PROBE=1` prints a load entry showing a SwiftShader adapter (vendor `google`); `BENCH_DEVICE=webgpu-absent BENCH_PROBE=1` prints `actualDevice: 'wasm'`.

## Acceptance Criteria

Second (cache-warm) wasm run completes in the container in < 20 s at the default BENCH_FILES and prints the JSON summary with wall-clock, files/s, chunks/s, dispatches, effective batch, padded tokens, paceWaitMs, latency stats, device/dtype/adapter, coldStartMs/warmupMs; BENCH_PROBE=1 prints the load entry only; nothing under bench/harness/ runs in npm run test; webgpu mode fails loudly if not on a real GPU; FakeVault extracted without fake-indexeddb.
