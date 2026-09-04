# Real-Obsidian e2e suite

`npm run test:e2e:obsidian` boots a REAL Obsidian (Electron) under Playwright and
drives Seeker through its rendered search modal. It is the release-time proof that
the shipped `main.js` loads, indexes, and ranks inside the actual app — the
retrieval gate (`docs/e2e-retrieval.md`) covers the same corpus through the stack
but without Obsidian's UI. Not part of `npm test`.

Architecture and the non-negotiable mechanics (CDP attach, tarball download,
headless flags, window-size seeding, runtime plugin enable, …) live in the deep
memory `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md`; they are not restated
here. Plan of record: ticket `nid_t5n3efu9vt5yk1drwg27q2uog_e`.

## Files

| File | Role |
|---|---|
| `scripts/setup-obsidian-bin.sh` | Linux-only: download + cache a pinned Obsidian tarball, print the binary path. |
| `scripts/run-e2e-obsidian.sh` | Entry point: resolve `OBSIDIAN_PATH`, default headless flags (Linux, no display), `npm run build`, run Playwright. |
| `e2e/obsidianHarness.ts` | Assembles the vault, seeds the sandbox, spawns Obsidian, attaches over CDP, enables the plugin. |
| `e2e/search.e2e.ts` | The suite (one Obsidian launch, serial). |
| `e2e/playwright.config.ts`, `e2e/tsconfig.json` | Runner config; `npm run typecheck` (root) is the type gate. |

## What the suite covers

One serial spec, one Obsidian launch, plugin DEFAULT settings (no `data.json`):

- **a.** `seeker:search` opens the modal with the query field focused.
- **b.** Fresh vault, no typing: the "Your vault isn’t indexed yet" onboarding shows.
- **c.** `runFullReindex({ skipConfirm: true })` completes and its last progress
  message reports every corpus note (150) indexed, with a non-zero chunk count.
- **d.** Every entry of `e2e/datasets/cqadupstack-android/curated-queries.json`
  typed into the modal ranks a row titled `expectDocId` within `maxRank`
  (10 parametrized tests; the failure message prints the top 5 titles).
- **e.** Enter on the top result opens that note (`app.workspace.getActiveFile()`).

Removal-from-index tests (drive Seeker's REAL incremental path — a vault
create/delete/modify fires the plugin's own vault-event handlers, which enqueue
the change; the test then drains via the production `flushDirty()`, bypassing
only its 5-min debounce; search runs headless through `orchestrator.search`, and
`ranking_signals.bm25 > 0` is the deterministic "the token is indexed for this
note" signal):

- **f.** A new note with a unique token is searchable, then GONE from results
  after `app.vault.delete` (the delete event is asserted to fire).
- **g.** After editing that token OUT of a note, the token has zero lexical
  presence anywhere — the stale chunk is dropped (no stale data left behind).
- **h.** Enables `indexImages` (ON by default; set explicitly here), renders known text into a PNG
  in-page (no committed binary fixture / licence question), OCRs + indexes it
  through the real `create → ocrPrepass → embed` path, proves the OCR word is
  searchable, then GONE after the image is deleted. The rendered text must be
  long enough to clear the chunker's 50-char `minChunkChars` or the image yields
  zero indexable chunks. Cold-run only: streams tesseract core + the eng pack
  from a CDN before the first recognise (cached in `userdata/` thereafter).

## Vault and caches under `.tmp/e2e/`

- `vault/` — assembled FRESH every run: the corpus notes at the root, minimal
  `.obsidian/` config, and the built `main.js`/`manifest.json`/`styles.css`.
- `userdata/` — Obsidian's `--user-data-dir`, PERSISTENT across runs on purpose:
  its Chromium HTTP cache holds the ~100 MB embedding model + transformers.js
  fetched from the CDN, so only the first run downloads. On every launch the
  harness re-writes `obsidian.json` + the window-state file and wipes ONLY
  `userdata/IndexedDB/`: the plugin's index is keyed by the `app://obsidian.md`
  origin, not the vault, so without that wipe run N boots already indexed and
  test b fails (observed 2026-09-03).
- Obsidian binaries: `${OBSIDIAN_CACHE_DIR:-~/.cache/obsidian-e2e}/obsidian-<version>/`.

Delete `.tmp/e2e/userdata` to force a cold run.

## Measured wall-clock (dev container, x86_64, wasm backend, 2026-09-03)

| Run | Whole `npm run test:e2e:obsidian` | Test c (reindex) |
|---|---|---|
| Cold (`userdata` absent, model downloaded) | 44 s | 37.9 s |
| Warm (model in `userdata/Cache`) | 39 s | 32.0 s |

The cold/warm gap is small because the container's CDN download is fast; the
persistent cache mainly matters on slow links. Both runs are well inside the
3-minute budget.
