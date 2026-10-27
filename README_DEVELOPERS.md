# Seeker — developer guide

Back to the main [README](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/README.md). Architecture and code conventions live in [`src/CLAUDE.md`](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/src/CLAUDE.md).

## Commands

| Command | What it does |
|---|---|
| `npm run build` / `npm run dev` | esbuild bundle to `main.js` (`dev` watches). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test` | Full vitest suite (unit + fast integration). |
| `npm run test:e2e:retrieval` | Slow retrieval-quality gate: indexes a frozen corpus through the real stack in Chromium and fails when ranking regresses. See [`docs/e2e-retrieval.md`](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/docs/e2e-retrieval.md). |
| `npm run test:e2e:obsidian` | Real-Obsidian (Electron) Playwright suite — see [below](#e2e-real-obsidian). |
| `npm run test:e2e` | The retrieval gate, then the Obsidian suite. |
| `npm run bench` / `npm run bench:host` | Indexing-performance bench. See [`docs/perf-bench.md`](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/docs/perf-bench.md). |
| `./release.sh [patch\|minor\|major]` | Cut a release: preflight, all gates, version bump + tag, push (the tag push publishes the GitHub Release). |

## E2E (real Obsidian)

`npm run test:e2e:obsidian` drives a REAL Obsidian (Electron) under Playwright
against a vault assembled from the committed e2e corpus, and asserts on the
search modal's rendered DOM. Linux auto-downloads a pinned Obsidian; headless
flags are defaulted when no display exists. See [`docs/e2e-obsidian.md`](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/docs/e2e-obsidian.md).

```bash
npm run test:e2e:obsidian                    # whole suite
npm run test:e2e:obsidian -- search.e2e.ts   # extra args pass through to Playwright
# macOS: point at the installed app (no auto-download outside Linux)
OBSIDIAN_PATH='/Applications/Obsidian.app/Contents/MacOS/Obsidian' npm run test:e2e:obsidian
```

| Env var | Meaning |
|---|---|
| `OBSIDIAN_PATH` | Obsidian binary to drive; when unset, Linux downloads a pinned build. |
| `OBSIDIAN_VERSION` | Overrides the pinned version for the auto-download (default `1.12.7`). |
| `OBSIDIAN_E2E_EXTRA_ARGS` | Extra Chromium/Electron flags; an explicit value disables the headless auto-default. |
| `OBSIDIAN_CACHE_DIR` | Where downloaded Obsidian builds are cached (default `~/.cache/obsidian-e2e`). |

## Test data licensing

Third-party **test data** committed under `e2e/datasets/*/` is NOT under this repo's MIT license; see each folder's `LICENSE-DATA.md` for its terms (e.g. BEIR CQADupstack-android content is CC BY-SA 4.0).
