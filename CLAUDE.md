# Seeker — Obsidian hybrid search plugin

On-device hybrid (dense semantic + BM25 lexical) vault search. Fork of Obsidian-Seek; see `README.md` for product/user docs.

## Commands
- `npm run test` — vitest run (full suite; `self_work.test.*.sh` wrap this).
- `npm run test:e2e` — slow retrieval-quality gate: indexes a frozen ~150-note corpus through the REAL stack in Chromium and fails when hybrid ranking regresses past the pinned baseline (`docs/e2e-retrieval.md`). Gated on `E2E=1`, not in `npm run test`; shares `.bench-cache/` with the bench so they can't run concurrently.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` / `npm run dev` — esbuild bundle to `main.js`.
- `node scripts/rename-plugin-id.mjs` — re-normalizes the plugin-id namespace (upstream id → `seeker`) after merging upstream Obsidian-Seek; its `--check` runs in the test suite.
- `./release.sh [patch|minor|major] [--no-push]` — cut a release: preflight (clean `main`, in sync) → typecheck/test/build → `npm version` (bumps manifest + versions.json, commits, tags the bare version) → atomic push of branch+tag (default; `--no-push` stops after tagging), firing `.github/workflows/release.yml` to build and publish the GitHub Release. Only the TAG push publishes (plain `git push` does not push tags); preflight refuses if the current version's tag is still unpushed.
- `npm run bench` / `bench:host` — THE indexing-performance bench (`docs/perf-bench.md`); run it when touching `src/search.ts` batching, `src/pacer.ts`, or `src/iframe-runner.ts` load/warmup.

## Layout
- `src/` — all plugin code, flat module layout with colocated `*.test.ts`. See `src/CLAUDE.md` for architecture and conventions.
  - Chunking: `src/chunker.ts` → `src/token-budget.ts`; summary + "revisit on model selection" note in `src/CLAUDE.md` §Chunking.
- `main.js`, `manifest.json`, `styles.css`, `versions.json` — Obsidian plugin release artifacts.

## Global invariants (cross-file, easy to miss)
- Editing `src/bm25.ts`, `src/tokenize.ts`, or `src/prop-normalize.ts` changes the build-time analyzer hash (`__SEEKER_ANALYZER_VERSION__` in `esbuild.config.mjs`) → users' persisted BM25 indexes refit automatically. Intentional; be aware.
- Changing persisted index shape requires bumping the owning module's version constant (e.g. `CHUNKER_VERSION`, `DB_VERSION`); `src/identity.ts` aggregates them into the index version identity that invalidates stored indexes.
- Popout-window convention: use `window.setTimeout` / `activeWindow`, never bare timer/window globals.

## CLI
- Use `ticket` for tickets and follow-ups.
- Use `change_log` for recording changes (at the end of ticket).
