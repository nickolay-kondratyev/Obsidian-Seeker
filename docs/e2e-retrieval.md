# Retrieval-quality e2e suite

THE slow gate that fails when the SHIPPED ranking regresses. It indexes a frozen
~150-note markdown corpus through the REAL production stack (`LocalEmbedder` →
`IframeRunner` → transformers.js in Chromium, `SearchOrchestrator`, `IndexStore`
on real IndexedDB), runs 30 real queries, and asserts aggregate nDCG@10 / Recall@10
do not drop below a pinned baseline.

It is an integration test by the strict definition; "e2e" names the slow real-model
gate. Plan of record: ticket `nid_dfk1ncuuf6zsfsszu2rzuwdws_e`.

## What is real vs faked

- **Real**: the embedder + transformers.js model (streamed from the CDN), the
  chunker, BM25, dense fusion, `SearchOrchestrator.reindexAll()` + `search()`, and
  IndexedDB inside a real Chromium page.
- **Faked**: only the Vault (`src/test-harness/fake-vault.ts`, in-memory files).
- **Ground truth**: BEIR CQADupstack-android (StackExchange duplicate-question
  pairs), a committed frozen subset — see
  `e2e/datasets/cqadupstack-android/README.md`.

## How to run

| Where | Command | Device | Chromium |
|---|---|---|---|
| Dev container (no GPU) | `npm run test:e2e` | `wasm` | system `/usr/bin/chromium` |
| Host | `npm run test:e2e` | `wasm` (default) | Playwright's bundled build, once: `npm run bench:setup` |

- `E2E_DEVICE=<key>` — any key of `DEVICE_PROFILES` (`bench/harness/run.mjs`);
  default `wasm`. `webgpu` needs a real GPU (host only), like the bench: the runner
  fails loudly (no result, nothing pinned) if the load fell back to wasm/SwiftShader,
  so a `webgpu`-labelled result or baseline is never secretly a wasm number.
- `E2E_CHANNELS=1` — additionally REPORT the dense-only (denseWeight 1) and
  bm25-only (denseWeight 0) channels in the table. Each re-embeds every query
  (~8 s on wasm). These are diagnostics, **never gated**.
- `BENCH_CHROMIUM` / `BENCH_CACHE_DIR` / `BENCH_PORT` — honoured exactly as in the
  bench (`bench/harness/run.mjs`).

The suite and the indexing bench **share** the `.bench-cache/` Chromium profile
(the ~100 MB model download) and the fixed origin/port, so **bench and e2e cannot
run concurrently**.

## Budget

Target `npm run test:e2e` wall-clock (warm model cache) in the container: **≤ 60 s**.
Measured on the reference container 2026-09-03: **~34 s** for **150 chunks**
(150 docs; index wall-clock ~30 s, first-query latency ~67 ms). Breakdown: index
~30 s at ~5 chunks/s wasm + 30 query embeds + launch/bundle/load. The first run
also downloads the ~100 MB model (one-off, not counted).

If it goes over budget: lower `TARGET_DOCS` / `QUERY_COUNT` in
`scripts/build-e2e-dataset.mjs`, regenerate the dataset (`npm run build:e2e-dataset`),
re-pin the baseline (below), and record the new time + chunk count here.

## Why gate the hybrid channel only

The plugin ships one ranking: hybrid fusion at `DEFAULT_SETTINGS.denseWeight`
(0.85). That is the only thing users experience, so it is the only thing gated.
Dense-only and bm25-only are useful to explain a regression but are not products,
hence `E2E_CHANNELS=1` reports them without asserting.

## The gate + tolerance

`e2e/retrieval.e2e.test.ts` asserts, for the hybrid channel:

- `nDCG@10 >= baseline.ndcg10 - TOLERANCE`
- `Recall@10 >= baseline.recall10 - TOLERANCE`

with `TOLERANCE = 0.02`. With 30 queries, one query's single gold doc leaving the
top 10 moves nDCG@10 by ~1/30 ≈ 0.033 — bigger than the tolerance. So the gate is
effectively "**no query may regress unless another improves**"; the 0.02 only
absorbs cross-machine floating-point noise in near-tie scores, not a real ranking
change. On failure the message lists the exact (query, doc) pairs whose gold docs
regressed versus the baseline's per-query ranks — either falling out of the top 10
or dropping to a worse rank within it.

**If a cross-machine run ever flips a rank, open a ticket — do NOT raise TOLERANCE
silently.**

## The pinned baseline & re-pin procedure

`e2e/datasets/cqadupstack-android/baseline.json` holds `{ pinnedAt, commit, device,
chunks, ndcg10, recall10, mrr10, perQueryGoldRank }`. The first green run pinned it.

Re-pin (`E2E_PIN_BASELINE=1 npm run test:e2e` writes the file instead of asserting)
ONLY after an **intended** ranking change:

- regenerating the dataset (`npm run build:e2e-dataset`),
- a chunker / tokenizer / BM25 / fusion change that is meant to change ranking.

Commit the new `baseline.json` alongside the change that caused it, so the diff
records why the numbers moved.

## When it fails

1. Read the failure message — it names the queries whose gold docs dropped out or
   fell in rank.
2. If your change was NOT meant to touch ranking, it is a real regression: fix it.
3. If it WAS meant to change ranking (see re-pin list), re-pin and commit.
4. If numbers differ only across machines in near-ties, open a ticket (do not
   raise `TOLERANCE`).
