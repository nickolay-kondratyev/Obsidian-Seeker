# Seeker — Obsidian hybrid search plugin

On-device hybrid (dense semantic + BM25 lexical) vault search. Fork of Obsidian-Seek; see `README.md` for product/user docs.

## Commands
- `npm run test` — vitest run (full suite; `self_work.test.*.sh` wrap this).
- `npm run test:e2e:retrieval` — slow retrieval-quality gate: indexes a frozen ~150-note corpus through the REAL stack in Chromium and fails when hybrid ranking regresses past the pinned baseline or a curated must-pass query misses its rank bound (`docs/e2e-retrieval.md`). Gated on `E2E=1`, not in `npm run test`; shares `.bench-cache/` with the bench so they can't run concurrently.
- `npm run test:e2e:obsidian` — real-Obsidian (Electron) Playwright suite: basic search flow in the rendered modal (`docs/e2e-obsidian.md`). Not in `npm run test`. `npm run test:e2e` runs the retrieval gate then this suite.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` / `npm run dev` — esbuild bundle to `main.js`.
- `node scripts/rename-plugin-id.mjs` — re-normalizes the plugin-id namespace (upstream id → `seeker`) after merging upstream Obsidian-Seek; its `--check` runs in the test suite.
- `./release.sh [patch|minor|major] [--no-push]` — cut a release: refuses to run in the dev container (releases are cut from the host) → preflight (clean `main`, in sync) → typecheck/test/build/`test:e2e:retrieval` retrieval gate/`test:e2e:obsidian` Obsidian gate → `npm version` (bumps manifest + versions.json, commits, tags the bare version) → atomic push of branch+tag (default; `--no-push` stops after tagging), firing `.github/workflows/release.yml` to build and publish the GitHub Release. The retrieval gate needs a resolvable Chromium (`npm run bench:setup` on the host) and network on its first run; the Obsidian gate auto-downloads Obsidian on Linux, defaults `OBSIDIAN_PATH` to the standard install on macOS. Only the TAG push publishes (plain `git push` does not push tags); preflight refuses if the current version's tag is still unpushed.
- `npm run bench` / `bench:host` — THE indexing-performance bench (`docs/perf-bench.md`); run it when touching `src/search.ts` batching, `src/pacer.ts`, or `src/iframe-runner.ts` load/warmup.

## Layout
- `src/` — all plugin code, flat module layout with colocated `*.test.ts`. See `src/CLAUDE.md` for architecture and conventions.
  - Chunking: `src/chunker.ts` → `src/token-budget.ts`; summary + "revisit on model selection" note in `src/CLAUDE.md` §Chunking.
- `main.js`, `manifest.json`, `styles.css`, `versions.json` — Obsidian plugin release artifacts.

## Global invariants (cross-file, easy to miss)
- Editing `src/bm25.ts`, `src/tokenize.ts`, or `src/prop-normalize.ts` changes the build-time analyzer hash (`__SEEKER_ANALYZER_VERSION__` in `esbuild.config.mjs`) → users' persisted BM25 indexes refit automatically. Intentional; be aware.
- Changing persisted index shape requires bumping the owning module's version constant (e.g. `CHUNKER_VERSION`, `DB_VERSION`); `src/identity.ts` aggregates them into the index version identity that invalidates stored indexes.
- Popout-window convention: use `window.setTimeout` / `activeWindow`, never bare timer/window globals.
- The production build MUST stay reproducible: `main.js` is a pure function of committed source so a rebuild of a tag matches the published asset (Obsidian's release check). No wall-clock/random/env in the bundle — `__BUILD_TS__` derives from `SOURCE_DATE_EPOCH`/HEAD commit date. Guarded by `scripts/build-reproducible.test.mjs`.

## CLI
- Use `ticket` for tickets and follow-ups.
- Use `change_log` for recording changes (at the end of ticket).
