---
session_ids: [{"a": "claude", "type": "decision", "id": "f77e61df-daa4-4731-b4ed-476bfaa25826"}]
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
tags: [perf, bench, indexing, webgpu]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on the corpus ticket. This is the measuring instrument every later lever ticket must use.

## DECISION (2026-09-02, decision session): runner = standalone Playwright script. APPROVED.
**Decided:** implement the harness as `bench/harness/run.mjs`, a standalone Node ESM script using `chromium.launchPersistentContext('.bench-cache/', ...)`, exactly as written up in the sections below. This supersedes the round-4 answer "runner = vitest browser mode (a)" recorded in the plan of record (nid_mw6gkmuurjhiqva4rr6doenul_e). Everything else the plan decided is unchanged: REAL `IframeRunner`/`LocalEmbedder`/`SearchOrchestrator`/IndexedDB, `BENCH_DEVICE=wasm|webgpu|webgpu-software` (+ `webgpu-absent`), one JSON object per run, `.bench-cache/` profile, < 20 s container target.

**Rationale (verified in the repo and in Playwright's documented behaviour):**
- Persistence is the binding constraint, and only `launchPersistentContext` provides it. Playwright's `browserType.launch()` throws when `--user-data-dir` is passed in `args` and tells you to use `launchPersistentContext`. vitest's playwright provider (2.x, and 3.x even with `connectOptions`) always creates the page in an ephemeral `browser.newContext()`, so the HTTP cache, the Cache API entries transformers.js writes the ~100 MB model into (`src/model-registry.ts`), and Dawn's shader cache are discarded per run. Without them every run re-downloads the model and the "1 warm-up + 3 reps, < 20 s" decisions are unmeetable in the container.
- Zero production change. The vitest-compatible alternative (a Vite caching proxy for jsdelivr + huggingface.co) needs `CDN_URL` in `src/iframe-runner.ts:38` (module const, also baked into the child srcdoc script at line 483) and transformers.js `env.remoteHost` to become injectable. That is a production seam added for the bench's sake, against the plan's "no production behavior change" rule and against POLS for plugin users.
- Same measuring instrument. The script bundles the same real modules with the same `obsidian` stub alias vitest uses (`vitest.config.ts`), runs the same sandboxed srcdoc iframe in a real Chromium, and emits the same JSON. Nothing the later lever tickets measure differs between the two runners.
- Full control of Chromium flags per `BENCH_DEVICE` and of the executable (`/usr/bin/chromium` in the container, verified present; no `/dev/dri`, so real WebGPU is host-only as already stated). No fight with vitest's orchestrator iframe / CSP around a nested sandboxed srcdoc iframe.
- Downstream tickets already assume the script: the ergonomics ticket spawns `node bench/harness/run.mjs`, and the rejection-test ticket spawns it with `BENCH_PROBE=1`. vitest stays the runner for the corpus coverage test and for that rejection test, so no test infrastructure is lost.

**Rejected options:**
- vitest browser mode + Vite caching proxy for the CDN/HF hosts: requires the production seam above; more moving parts (proxy, vitest browser provider config, vitest's iframe nesting) for no measurement benefit.
- vitest browser mode + Playwright `context.route()` disk cache: routing is a Node-side API, so it would need vitest custom `server.commands` plumbing around the provider's context; still ephemeral profile (no Dawn shader cache), and it re-implements what the persistent profile gives for free.
- Fake/shortened model to fit the time budget: explicitly ruled out by the plan (real CPU inference is the human's correction on record).

**Implementation notes for whoever picks this up (not new decisions, just guardrails):**
- Prefer the `playwright-core` package over `playwright` as the devDependency if its `install` CLI (`npx playwright-core install chromium`) satisfies the ergonomics ticket's `bench:setup`; `playwright` has a postinstall browser download the container never uses (it runs system Chromium via `executablePath`). Either package is acceptable; do not let this block the work.
- Keep every Chromium flag set in ONE table in `run.mjs` keyed by `BENCH_DEVICE`, since `bench:host` (ergonomics ticket) must print them and must not duplicate them.
- The `FakeVault` extraction out of `src/test-harness/scenario.ts` (which imports `fake-indexeddb/auto` at line 22) remains REQUIRED; re-export from `scenario.ts` so existing tests are untouched.

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
