---
id: nid_tthbuk08rra4lyenl50t6de1c_e
title: "E2E retrieval suite: browser harness search entry, metrics, aggregate gate, baseline pin"
status: open
deps: [nid_dfk1ncuuf6zsfsszu2rzuwdws_e, nid_4wklzxci3244xy0dv1knvjc20_e]
links: []
created_iso: 2026-09-03T18:17:12Z
status_updated_iso: 2026-09-03T18:17:12Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval]
---

Part 2 of 3 of plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e (read it first). Depends on the dataset from ticket 1 (`e2e/datasets/cqadupstack-android/`). This ticket: the runnable suite + aggregate gate + pinned baseline.

## Reuse, do not duplicate
- `bench/harness/run.mjs` exports `chromiumArgs`, `resolveChromiumPath`, `DEVICE_PROFILES`, `BASE_CHROMIUM_ARGS`; its `serve()`/launch/`page.goto` + `waitForFunction` flow and `.bench-cache/` persistent profile at port 47331 are what to reuse. Extract shared pieces (serve, launch, cache dir/port constants) into a small module (e.g. `bench/harness/browser.mjs`) imported by BOTH run.mjs and the new e2e runner rather than copy-pasting; keep bench behaviour byte-identical (`npm run bench` still works; `BENCH=1 npx vitest run bench/harness/webgpu-software.test.ts` still passes).
- `bench/harness/page.ts` (`window.__seekerBench`, `loadModel`, FakeVault wiring, `CacheWarmDrainer`, `deleteDb`) and `bench/harness/esbuild.mjs` (bundle with `obsidian` aliased to src/test-stubs/obsidian.ts). Add a page entry (either a new `e2e/harness/page.ts` sharing helpers moved out of the bench page, or a new method on the bench API) exposing: `evalRetrieval(device, files, queries: {id,text}[], topK, denseWeights: number[]) -> { index: IndexCompleteEntry, coldStartMs, perWeight: { [alpha]: { [queryId]: { path: string, score: number, signals: ranking_signals }[] } }, timings }`. Implementation: load model, FakeVault with the corpus files, IndexStore fresh scope, `SearchOrchestrator.reindexAll()`, drain cache warm, then for each alpha construct a SearchOrchestrator with `structuredClone(DEFAULT_SETTINGS)` and `denseWeight = alpha` sharing the same store + embedder, and call `search(text, topK)` per query. If sharing a store across orchestrators proves unsafe, fall back to ONE orchestrator and sequentially set `settings.denseWeight` between passes with a WHY comment (single-threaded harness, so the concurrency hazard in search.ts's comment does not apply). Dispose/teardown/deleteDb exactly as the bench page does. Return top-`topK` UNIQUE note paths per query (dedupe chunks by path keeping best rank; fetch e.g. topK*3 chunks from search() to have enough after dedupe).
- Doc id = basename of path without `.md`.

## Runner + test
- `e2e/harness/run.mjs`: node script, prints ONE JSON on stdout (logs to stderr) like the bench runner. Env: `E2E_DEVICE` (default wasm; reuse DEVICE_PROFILES), `E2E_CHANNELS=1` adds denseWeight 1 and 0 passes (default: only DEFAULT_SETTINGS.denseWeight), `BENCH_CHROMIUM`/`BENCH_CACHE_DIR`/`BENCH_PORT` honoured as in the bench.
- `e2e/metrics.ts` (pure, unit-tested in `e2e/metrics.test.ts`): nDCG@k (binary gains), Recall@k, MRR@k over `{queryId -> rankedDocIds[]}` + `{queryId -> relevantDocIds[]}`. Small, explicit; one assert per test, GIVEN/WHEN/THEN.
- `e2e/retrieval.e2e.test.ts` (vitest, in the default include but `describe.skipIf(process.env.E2E !== '1')` so plain `npm test` skips it; testTimeout ~10 min because the first run downloads the ~100 MB model): spawns the runner once (`beforeAll`), computes metrics for each weight, prints a table (weight | nDCG@10 | Recall@10 | MRR@10 | queries), plus index wall-clock and chunk count. Asserts: hybrid nDCG@10 >= baseline.ndcg10 - TOLERANCE and hybrid Recall@10 >= baseline.recall10 - TOLERANCE with TOLERANCE=0.02 (named constant, WHY: wasm is deterministic on one machine; the tolerance absorbs cross-machine float noise, not ranking changes). Failure message must list the queries whose gold docs fell out of the top 10 versus the baseline's per-query ranks (so store per-query gold ranks in the baseline too).
- `e2e/datasets/cqadupstack-android/baseline.json`: `{ pinnedAt, commit, device, chunks, ndcg10, recall10, mrr10, perQueryGoldRank: {queryId: {docId: rank|null}} }`. Pinned by running with `E2E_PIN_BASELINE=1` (the test writes the file instead of asserting). First green run pins it; document the re-pin procedure.
- package.json: `"test:e2e": "E2E=1 vitest run e2e/retrieval.e2e.test.ts"` (use cross-platform env via node if needed; the repo already assumes bash for other scripts).
- Docs: `docs/e2e-retrieval.md` (what is real vs faked, how to run in container/host, budget, what to do when it fails, re-pin procedure, why hybrid-only gating, E2E_CHANNELS). Add a one-line pointer in the root CLAUDE.md `## Commands` and in bench/harness header comments where shared modules moved.

## Budget check (acceptance)
- Measure `npm run test:e2e` wall-clock (warm model cache) in the container; target <= 60 s. If over, lower TARGET_DOCS/QUERY_COUNT in scripts/build-e2e-dataset.mjs, regenerate, and adjust the pin test bounds from ticket 1 (baseline is not pinned until this passes). Record the measured time + chunk count in docs/e2e-retrieval.md.
- `npm run test`, `npm run typecheck`, `npm run build`, `npm run bench` (smoke, BENCH_FILES=3 is fine) all green.

