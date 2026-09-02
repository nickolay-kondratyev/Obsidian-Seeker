# src/ — architecture

Flat module layout; entry point is `main.ts` (esbuild bundles it to `../main.js`, plus `binary-worker.ts` as an injected worker-source string `__BINARY_WORKER_SRC__`).

## Layers (data flow top→bottom)
- **Orchestration**: `main.ts` (plugin lifecycle, commands) → `search.ts` (`SearchOrchestrator` — the hub for reindex + query) with `index-coordinator.ts` (shared FIFO write mutex + generation counters). `types.ts` = shared types/log schema.
- **Indexing**: vault walk → `chunker.ts` (built on `atoms.ts`) → `token-budget.ts` → `dense-clean.ts` → `embedder.ts` → `iframe-runner.ts` (sandboxed iframe hosting transformers.js). Pacing/lifecycle: `pacer.ts`, `catchup.ts`, `embedder-lifecycle.ts`, `model-registry.ts`.
- **Storage**: `index-store.ts` (IndexedDB) with `quant.ts` (SQ8), `binary.ts` (sign-bits), `identity.ts` (index version fingerprint), `sidecar*.ts` (file-based replica for sync/IDB-eviction recovery), `gzip.ts`.
- **Retrieval/ranking**: stage-1 candidates via `binary.ts`+`select.ts` (off-thread through `binary-scorer.ts`↔`binary-worker.ts` on desktop) and `bm25.ts`+`tokenize.ts`; stage-2 int8 rerank → `ranker.ts`/`fusion.ts`. Query side: `query-parser.ts`, `synonyms.ts`.
- **UI**: `search-modal.ts` composed of `query-field.ts`, `suggest.ts`, `passage.ts`/`snippet.ts`/`highlight.ts` (pure, Obsidian-free), `recents.ts`, `insert-link.ts`; `settings-tab.ts`.
- **Diagnostics**: `logger.ts` (NDJSON→report), `redact.ts`, `forensics.ts`, `platform.ts`.

## Chunking (where + what to know)
- Lives in `chunker.ts` (heading split, folding, ids) → `token-budget.ts` (512-token window, atom-boundary re-split, the ONLY overlap: within split super-sections). Read the "Pipeline at a glance" header comment in `chunker.ts` first.
- One chunk per heading section is the norm; overlap is the exception, not a blanket window.
- Model-coupled: budget, seq buckets and tokenizer belong to the active model. **Revisit chunking when user-selectable models land.**

## Conventions
- Unit tests colocate as `foo.test.ts`. Test files with no same-named source (`atomic-commit.test.ts`, `drift-recovery.test.ts`, …) are cross-module invariant/scenario tests — do not "fix" the missing source file.
- All index mutations go through the coordinator's write lock; full reindex nukes the DB and subsumes queued deltas.
- Worker/iframe split: iframe = model runtime (needs looser srcdoc CSP); Blob-URL worker = pure obsidian-free compute that MUST stay ranking-identical to the sync fallback.
- Sub-folders: `test-harness/` (tier-2 scenario harness — see its CLAUDE.md), `test-stubs/` (vitest `obsidian` stub — see its CLAUDE.md), `fixtures/` (markdown edge-case corpora for `atoms.test.ts` / `token-budget.test.ts`).
