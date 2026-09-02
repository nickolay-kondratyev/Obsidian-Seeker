---
id: nid_pt77674z2iel2w8rmdga3bvkb_e
title: "Bench harness: vitest browser-mode full-reindex throughput bench on the REAL embedder (BENCH_DEVICE=wasm|webgpu|webgpu-software)"
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

## Goal
`BENCH=1 npx vitest run --project bench` (exact invocation decided here; the ergonomics ticket wraps it in npm scripts) runs a FULL reindex of `bench/corpus/` through the production path inside a real Chromium page and prints: wall-clock ms, files/s, chunks/s, embed dispatches, effective batch, padded tokens, paceWaitMs, embedBatchLatencyMs p50/p95, resolved device + adapter info. Must not run under plain `npm run test` (gate with `describe.skipIf(!process.env.BENCH)` like `src/binary.test.ts:93`, AND a separate vitest project/config so browser mode never loads for unit tests).

## How (decided)
- vitest 2.1.9 browser mode (`@vitest/browser` + `playwright` devDependencies, provider `playwright`, browser `chromium`, headless). Launch args via `providerOptions.launch.args` (v2 API; `instances` is v3). Container: use system Chromium at `/usr/bin/chromium` (`executablePath`), args `--no-sandbox --disable-dev-shm-usage`; no `/dev/dri` in the container so WebGPU is impossible there. Host: Playwright's bundled chromium or system one.
- `BENCH_DEVICE`:
  - `wasm` (default): no GPU flags; plugin device `'wasm'`.
  - `webgpu`: add `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist` (verified on the reference host: Fedora, Ryzen AI MAX+ 395 / Radeon 8060S); plugin device `'auto'`; FAIL the run (do not silently record) if the resolved device is not a real GPU.
  - `webgpu-software`: add `--enable-unsafe-webgpu` only (container Chromium then exposes a SwiftShader adapter: vendor `google`); plugin device `'auto'`. Used by the rejection-test ticket.
- Persistent Chromium profile dir (git-ignored `.bench-cache/`) so transformers.js from jsdelivr (`CDN_URL`, `src/iframe-runner.ts` line 38) and the HF model weights download once. Network to both verified from the container.
- Drive the REAL stack: `LocalEmbedder` + `IframeRunner` (`src/embedder.ts`, `src/iframe-runner.ts` — sandboxed srcdoc iframe; check the page CSP vitest serves allows `frame-src`/`script-src` for jsdelivr/HF; if it fights, document the fallback = standalone Playwright script + esbuild bench page, do NOT weaken production CSP), the REAL `SearchOrchestrator` (`src/search.ts`, `reindexAll` ~line 344 returns `IndexCompleteEntry` with the counters), REAL `IndexStore` on the browser's IndexedDB (fresh DB name per run, deleted after). Reuse `FakeVault` from `src/test-harness/scenario.ts` (extract it into an Obsidian-free module if needed) fed from the corpus files (read via vitest's `import.meta.glob` or a server command). The `obsidian` alias stub `src/test-stubs/obsidian.ts` must resolve in the browser too (`src/platform.ts`, `src/logger.ts`, `src/search.ts` import it); extend the stub minimally rather than touching production.
- `BENCH_FILES=N` caps files (sorted path order). Container target: < 20 s for the default N on WASM; pick N accordingly and document it.
- Output: one JSON object per run to stdout (stable keys) — the ergonomics ticket appends it to `.bench/results.ndjson`.

## Non-goals
- No production behavior change. No timing assertions in tests (machine-dependent). No CI wiring (CI has no GPU; the WASM run may be added later as opt-in).

## Files
- `bench/harness/` (new), `vitest.bench.config.mts` (new), `package.json` devDependencies, `.gitignore` (+ `.bench-cache/`, `.bench/`), `src/test-stubs/obsidian.ts` (extend), possibly `src/test-harness/scenario.ts` (extract FakeVault).

## Verify in the container before closing
`BENCH=1 BENCH_DEVICE=wasm` completes on the corpus and prints the JSON; `BENCH_DEVICE=webgpu-software` resolves to a SwiftShader adapter (pre-lever-#0a it will load as webgpu; that is expected until #0a lands).

## Acceptance Criteria

BENCH=1 run on wasm completes in the container in < 20 s at the default BENCH_FILES and prints the JSON summary with wall-clock, files/s, chunks/s, dispatches, effective batch, padded tokens, paceWaitMs, latency stats, device/adapter; not executed by npm run test; webgpu mode fails loudly if not on a real GPU.

