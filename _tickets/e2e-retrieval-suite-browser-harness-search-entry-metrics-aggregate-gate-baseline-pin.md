---
closed_iso: 2026-09-03T19:00:26Z
session_ids: [{"a": "claude", "type": "execution", "id": "c48e5821-6a6f-4c5f-a8ac-2dffbe968ff6"}, {"a": "claude", "type": "review", "id": "cdbc49c3-8bd4-4745-807e-9c0fc5923165"}, {"a": "claude", "type": "review", "id": "9215b602-3c21-48c2-9ec6-95816fcc352a"}, {"a": "claude", "type": "review", "id": "7f82386e-234b-4a7f-ab14-2858f3e9b16f"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-3
id: nid_tthbuk08rra4lyenl50t6de1c_e
title: "E2E retrieval suite: browser harness search entry, metrics, aggregate gate, baseline pin"
status: closed
deps: [nid_dfk1ncuuf6zsfsszu2rzuwdws_e, nid_4wklzxci3244xy0dv1knvjc20_e]
links: []
created_iso: 2026-09-03T18:17:12Z
status_updated_iso: 2026-09-03T19:00:26Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval]
---

Part 2 of 3 of plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e (read it first, especially "Key facts for implementers"). Depends on the dataset from ticket 1 (`e2e/datasets/cqadupstack-android/`, tsconfig already includes e2e/). This ticket: the runnable suite + aggregate gate + pinned baseline.

## Reuse, do not duplicate
- `bench/harness/run.mjs` exports `chromiumArgs`, `resolveChromiumPath`, `DEVICE_PROFILES`, `BASE_CHROMIUM_ARGS`; its `serve()`/launch/`page.goto` + `waitForFunction` flow and `.bench-cache/` persistent profile at port 47331 are what to reuse. Extract shared pieces (serve, launch, cache dir/port constants, PAGE_HTML) into a small module (e.g. `bench/harness/browser.mjs`) imported by BOTH run.mjs and the new e2e runner rather than copy-pasting; keep bench behaviour byte-identical (`npm run bench` still works; `BENCH=1 npx vitest run bench/harness/webgpu-software.test.ts` still passes; scripts/bench.mjs keeps importing `chromiumArgs`/`resolveChromiumPath`/`DEFAULT_BENCH_FILES` from run.mjs).
- `bench/harness/esbuild.mjs` hard-codes `entryPoints: ['bench/harness/page.ts']`; give `buildBenchBundle` an entry-point parameter (default unchanged) so the e2e page bundles through the same defines/alias.
- `bench/harness/page.ts` (`window.__seekerBench`, `loadModel`, FakeVault wiring, `CacheWarmDrainer`, `deleteDb`). Add a page entry (a new `e2e/harness/page.ts` sharing helpers moved out of the bench page, or a new method on the bench API) exposing:
  `evalRetrieval(device, files, queries: {id,text}[], topK, denseWeights: number[]) -> { index: IndexCompleteEntry, load: LoadEntry, perWeight: { [alpha]: { [queryId]: { noteId: string, title: string, score: number, signals: ranking_signals }[] } }, timings: { indexMs, firstQueryMs, queriesMs: { [alpha]: number } } }`.
  Implementation: load model, FakeVault with the corpus files, IndexStore fresh scope, ONE `SearchOrchestrator` built with a settings object you keep a reference to (`const settings = structuredClone(DEFAULT_SETTINGS)`), `reindexAll()`, drain cache warm, then for each alpha set `settings.denseWeight = alpha` and call `search(text, topK)` per query. WHY one orchestrator + mutation: `settings` is private but held by reference and read per call; the harness is single-threaded so the overlapping-caller hazard documented above search() cannot occur (say so in a comment). WHY NOT one orchestrator per alpha: each would rebuild the frame + BM25 caches from IndexedDB. Restore `settings.denseWeight` to the default after the loop. Dispose/teardown/deleteDb exactly as the bench page does.
  `search()` already returns <= topK UNIQUE notes (stage S3 `dedupByPath`); map each result to `noteId = basename(note_path, '.md')`. Do not over-fetch or re-dedupe. Report the first query's latency separately (`firstQueryMs`): it pays the one-off frame + BM25 cache build.
- Doc id = basename of `note_path` without `.md`.

## Runner + test
- `e2e/harness/run.mjs`: node script, prints ONE JSON on stdout (logs to stderr) like the bench runner. Env: `E2E_DEVICE` (default wasm; reuse DEVICE_PROFILES), `E2E_CHANNELS=1` adds denseWeight 1 and 0 passes (default: only DEFAULT_SETTINGS.denseWeight), `BENCH_CHROMIUM`/`BENCH_CACHE_DIR`/`BENCH_PORT` honoured as in the bench. Reads `e2e/datasets/cqadupstack-android/{corpus,queries.json}`.
- `e2e/metrics.ts` (pure, unit-tested in `e2e/metrics.test.ts`): nDCG@k (binary gains), Recall@k, MRR@k over `{queryId -> rankedDocIds[]}` + `{queryId -> relevantDocIds[]}`, plus per-query gold ranks. Small, explicit classes; one assert per test, GIVEN/WHEN/THEN.
- `e2e/retrieval.e2e.test.ts` (vitest default include already matches it; `describe.skipIf(process.env.E2E !== '1')` so plain `npm test` skips it; testTimeout ~10 min because the first run downloads the ~100 MB model): spawns the runner once (`beforeAll`), computes metrics for each weight, prints a table (weight | nDCG@10 | Recall@10 | MRR@10 | queries), plus index wall-clock, first-query latency and chunk count. Asserts: hybrid nDCG@10 >= baseline.ndcg10 - TOLERANCE and hybrid Recall@10 >= baseline.recall10 - TOLERANCE with `TOLERANCE = 0.02` (named constant). Document in its WHY comment what the number means: with 30 queries one query's gold falling out of the top 10 moves nDCG@10 by ~0.033, so the gate is effectively "no query may regress unless another improves"; the tolerance exists to absorb cross-machine float noise in near-ties, not ranking changes. If cross-machine runs ever flip a rank, open a ticket rather than raising TOLERANCE silently. Failure message must list the queries whose gold docs fell out of the top 10 versus the baseline's per-query ranks.
- `e2e/datasets/cqadupstack-android/baseline.json`: `{ pinnedAt, commit, device, chunks, ndcg10, recall10, mrr10, perQueryGoldRank: {queryId: {docId: rank|null}} }`. Pinned by running with `E2E_PIN_BASELINE=1` (the test writes the file instead of asserting). First green run pins it; document the re-pin procedure (any dataset regeneration, chunker/tokenizer/BM25/fusion change that is INTENDED to change ranking).
- package.json: `"test:e2e": "E2E=1 vitest run e2e/retrieval.e2e.test.ts"` (the repo already assumes bash for other scripts).
- Docs: `docs/e2e-retrieval.md` (what is real vs faked, how to run in container/host, budget, what to do when it fails, re-pin procedure, why hybrid-only gating, E2E_CHANNELS, that bench and e2e share the Chromium profile so they cannot run concurrently). Add a one-line pointer in the root CLAUDE.md `## Commands` and in bench/harness header comments where shared modules moved.

## Budget check (acceptance)
- Measure `npm run test:e2e` wall-clock (warm model cache) in the container; target <= 60 s. Expected: ~150 chunks at ~4 chunks/s (~38 s) + 30 query embeds (~8 s) + launch/bundle/load (~5 s). If over, lower TARGET_DOCS/QUERY_COUNT in scripts/build-e2e-dataset.mjs, regenerate (the pin test follows the constants automatically), and re-pin. Record the measured time + chunk count in docs/e2e-retrieval.md.
- `npm run test`, `npm run typecheck`, `npm run build`, `npm run bench` (smoke, BENCH_FILES=3 is fine) and `BENCH=1 npx vitest run bench/harness/webgpu-software.test.ts` all green.

## Resolution (2026-09-03)

Done and all acceptance checks green.

**Shared harness extraction (bench behaviour byte-identical):**
- `bench/harness/browser.mjs` (NEW) — serve + `withBrowserPage()` launch/persistent-profile flow + `DEFAULT_PORT`/`DEFAULT_CACHE_DIR`/`BASE_CHROMIUM_ARGS`/`resolveChromiumPath`. Imported by both runners.
- `bench/harness/run.mjs` — now imports the above and re-exports `resolveChromiumPath`/`BASE_CHROMIUM_ARGS` so `scripts/bench.mjs`'s existing import is unchanged. `DEVICE_PROFILES`/`chromiumArgs`/`DEFAULT_BENCH_FILES` stay here.
- `bench/harness/esbuild.mjs` — `buildBenchBundle(entryPoint = 'bench/harness/page.ts')`; e2e passes `'e2e/harness/page.ts'`.
- `bench/harness/page-common.ts` (NEW) — Obsidian shims + `loadModel`/`harnessSettings`/`BeatCapture`/`logger`/`deleteDb`/`ProbeResult`/`CorpusFile`, shared by both page entries. `bench/harness/page.ts` reduced to bench-specific `probe`/`run`.

**E2E suite:**
- `e2e/harness/page.ts` (NEW) — `window.__seekerE2E = { defaultDenseWeight, evalRetrieval }`. ONE `SearchOrchestrator` + mutate `settings.denseWeight` between channels; restores it after. `noteId = basename(note_path, '.md')`; no re-dedupe (S3 already dedupes). `firstQueryMs` = latency of the first `search()` call.
- `e2e/harness/run.mjs` (NEW) — spawns Chromium, prints ONE JSON. Env `E2E_DEVICE` (default wasm), `E2E_CHANNELS=1` (adds α=1 dense-only + α=0 bm25-only), `BENCH_CHROMIUM`/`BENCH_CACHE_DIR`/`BENCH_PORT`.
- `e2e/metrics.ts` + `e2e/metrics.test.ts` (NEW) — pure `QueryRanking` + `RetrievalMetrics` (nDCG@k binary gains, Recall@k, MRR@k, per-query gold ranks). 15 unit tests.
- `e2e/retrieval.e2e.test.ts` (NEW) — `describe.skipIf(E2E!=='1')`, spawns runner once, prints table, gates HYBRID nDCG@10 & Recall@10 `>= baseline - 0.02`. `E2E_PIN_BASELINE=1` writes the baseline instead. Failure message lists (query, doc) pairs whose gold fell out of top 10.
- `e2e/datasets/cqadupstack-android/baseline.json` (NEW, pinned) — device=wasm, chunks=150, **nDCG@10=0.899, Recall@10=1.0, MRR@10=0.875**, full `perQueryGoldRank`.
- `package.json` — `"test:e2e": "E2E=1 vitest run e2e/retrieval.e2e.test.ts"`.
- `docs/e2e-retrieval.md` (NEW) + root `CLAUDE.md` `## Commands` pointer.

**Measured (reference container, warm model cache):** `npm run test:e2e` = **~34 s** (≤ 60 s budget), 150 chunks, index wall-clock ~30 s, first-query ~67 ms. Channels (`E2E_CHANNELS=1`): hybrid 0.899 / dense-only 0.929 / bm25-only 0.764 nDCG@10 — dense-only edges hybrid on this small subset; only hybrid (the shipped ranking) is gated.

**Acceptance:** `npm run test` (1369 passed), `typecheck`, `build`, `bench` (BENCH_FILES=3), `BENCH=1 vitest webgpu-software.test.ts` (5 passed), `npm run test:e2e` all green.

**Re-pin procedure:** `E2E_PIN_BASELINE=1 npm run test:e2e` after any INTENDED ranking change (dataset regen, or chunker/tokenizer/BM25/fusion change). Do NOT raise TOLERANCE for cross-machine rank flips — open a ticket. See `docs/e2e-retrieval.md`.

## Notes

**2026-09-03T19:05:05Z**

__REVIEW_AGAIN__: Branch is solid (typecheck+full suite pass, both page bundles compile, re-export chain intact); fixed a misleading gate diagnostic (now reports within-top-10 rank drops, not just dropouts) — that logic change plus the never-CI-run Chromium e2e path warrant a fresh pass.
