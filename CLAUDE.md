# Seeker — Obsidian hybrid search plugin

On-device hybrid (dense semantic + BM25 lexical) vault search. Fork of Obsidian-Seek; see `README.md` for product/user docs.

## Commands
- `npm run test` — vitest run (full suite; `self_work.test.*.sh` wrap this).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` / `npm run dev` — esbuild bundle to `main.js`.

## Layout
- `src/` — all plugin code, flat module layout with colocated `*.test.ts`. See `src/CLAUDE.md` for architecture and conventions.
  - Chunking: `src/chunker.ts` → `src/token-budget.ts`; summary + "revisit on model selection" note in `src/CLAUDE.md` §Chunking.
- `tests/relevance-cases.json` — illustrative relevance-regression case set (not wired into a runner).
- `main.js`, `manifest.json`, `styles.css`, `versions.json` — Obsidian plugin release artifacts.

## Global invariants (cross-file, easy to miss)
- Editing `src/bm25.ts`, `src/tokenize.ts`, or `src/prop-normalize.ts` changes the build-time analyzer hash (`__SEEK_ANALYZER_VERSION__` in `esbuild.config.mjs`) → users' persisted BM25 indexes refit automatically. Intentional; be aware.
- Changing persisted index shape requires bumping the owning module's version constant (e.g. `CHUNKER_VERSION`, `DB_VERSION`); `src/identity.ts` aggregates them into the index version identity that invalidates stored indexes.
- Popout-window convention: use `window.setTimeout` / `activeWindow`, never bare timer/window globals.
