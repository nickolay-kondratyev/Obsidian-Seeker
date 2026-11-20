---
id: nid_aqto46kr20cwc4w3ry61b851l_e
title: "Opened 1/3: record each note's last-opened time in a per-device open-history file"
status: in_progress
deps: []
links: []
created_iso: 2026-11-20T16:42:21Z
status_updated_iso: 2026-11-20T17:03:50Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_8mpjxf78jw4ita3azfwijr4g8_e
tags: [opened-filter]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.worktree/t-aqto46kr
---


Part 1 of 3 of feature `nid_8mpjxf78jw4ita3azfwijr4g8_e` (read its "Decisions" section first; they are settled).

## Goal

Seeker knows when each vault file was last opened on THIS device and vault, and the knowledge survives restarts, a full reindex and IndexedDB eviction. Nothing reads it yet: ticket `nid_cwgsa0eizaicst9n1h2pq0wyi_e` (the `opened-after:` filter) and ticket `nid_5icqphif0kxwg5pgygti668d8_e` (cross-device merge) build on the store this ticket delivers.

## Done criteria

- When a file becomes the active file (Obsidian `app.workspace.on('file-open')` with a non-null file), its vault-relative path is stamped with the current time. The in-memory lookup reflects it immediately.
- The stamp reaches disk without the user doing anything: after a short debounce, and best-effort when the app is backgrounded / the plugin unloads (the app can be killed right after on mobile).
- After a plugin restart the lookup returns the persisted times.
- Rename inside Obsidian (`app.vault.on('rename')`): the new path returns the old path's time and the old path returns nothing. Renaming a FOLDER carries every opened file inside it. Whether real Obsidian fires a rename event per child file, only the folder's event, or both is NOT verified in this repo: handle a folder event and per-file events idempotently (unit test: both arriving for one rename gives the same result as either alone).
- The file cannot grow without bound: it is rewritten to one line per path (newest time wins; paths no longer in the vault dropped) at startup and again once enough lines were appended since the last rewrite (a desktop session can run for weeks). A test proves a long run of opens of a few notes ends up as a few lines.
- A torn or unparseable line (crash mid-append, partially synced file) is skipped and every other line still loads.
- A rewrite interrupted by a crash loses nothing: if at load the file is missing but the rewrite's temp file is there, the temp file is used. Covered by a test.
- An append that fails (see `appendJsonlLine` in `src/sidecar.ts`: `DataAdapter.append` can throw on iOS under iCloud contention) does not lose the stamp: it is retried or written another way.
- Opens recorded before the startup load finished are not lost when the load completes.
- No existing sidecar code touches the file or its temp file (full reindex, rebuild from sidecar, compaction/reaping, legacy migration, boot temp-file sweep, reconcile wake-up). This holds by construction, see Context; the test for it: `deviceIdFromArtifactPath` (`src/sidecar.ts`) returns null for the file's path, and `sidecarDirSignature` is the same before and after a write.
- The file exists and is updated with `sidecarEnabled` off.
- Works on mobile (no Node `fs`; only Obsidian's `DataAdapter`).
- `src/main.ts` creates the one store instance at plugin load (it owns the events and the background flush) and hands it to `SearchOrchestrator` (`src/search.ts`), so ticket `nid_cwgsa0eizaicst9n1h2pq0wyi_e` only has to read it there.
- Unit tests cover the store with an in-memory adapter fake and an injected clock (no real timers, no `sleep`). `npm run test` and `npm run typecheck` pass.
- Checked once by hand or in the real-Obsidian harness (`e2e/obsidianHarness.ts`) and written down in the module's header comment: `file-open` does NOT fire for a hover preview or for background tabs restored at startup. If it does fire for either, stop and raise it (it contradicts a settled decision). The restored FOREGROUND tab may count as an open (the user is looking at it): do not add code to suppress it.
- `src/CLAUDE.md` Storage layer line mentions the new module (one short clause).

## Context

- Sidecar index directory: `resolveSidecarIndexDir()` in `src/main.ts` (always a string; config-dir or visible-dir variant per `settings.sidecarIndexLocation`), passed to the `SearchOrchestrator` constructor as `indexDir`. The OCR cache already lives in a sub-folder of it: `src/ocr-cache.ts` (`<index dir>/ocr/<sha>.json`), created in that constructor. It is the precedent for "rides the sidecar directory but ignores the sidecar setting", and for an Obsidian-free module behind a small structural adapter interface (`OcrCacheAdapter`; it has no `append`/`rename`, so this store needs its own) with an in-memory test fake (`src/ocr-cache.test.ts`).
- Producer id: `logger.producerId` = `<deviceId>-<vaultKey>` (`producerIdFor` in `src/logger.ts`; charset alnum + dash). File ownership always keys on it, never on `logger.deviceId` — several vaults can share one symlinked `.obsidian/plugins` folder and therefore this directory (see `src/CLAUDE.md` Conventions, and the header of `src/sidecar.ts`).
- Existing vault watchers (`create`/`delete`/`rename`, `active-leaf-change`, window `blur`) are in `wireIncrementalIndexing` in `src/main.ts` (called by `startIndexMaintenance`). "Flush before the OS kills us" is `flushOnBackground` in `src/main.ts`, fired from `visibilitychange`, `pagehide` and `blur`. Nothing listens to `file-open` today.
- Per-producer append-only jsonl with own-file compaction is the existing sidecar pattern (`src/sidecar.ts`). Atomic whole-file write: exported `writeTextAtomic` there (write `<path>.tmp`, then rename; on iOS the rename-over-existing fallback is remove-then-rename, so a crash can leave ONLY the `.tmp`).
- What already walks the sidecar directory, and why a sub-folder with its own file name is safe from each:
  - Every sidecar lister/reaper/signature (`listDeviceJsonls`, `listDeviceMetas`, `listSidecarDeviceIds`, `clearDevice`, `sidecarDirSignature` in `src/sidecar.ts`; `listProducerSidecarFiles` in `src/legacy-sidecar-migration.ts`; `migrateSidecarFiles` in `src/main.ts`) reads only the directory's top-level files, and only names `deviceIdFromArtifactPath` recognises.
  - `sweepOrphanTmpFiles` (`src/sidecar.ts`) DOES recurse into sub-folders, but only acts on a `.tmp` whose real name matches `SHARD_RE` / `JSONL_RE` / `META_RE` / `BM25_RE`, and it only runs with `sidecarEnabled` on. So it neither harms nor recovers this store's temp file: the store recovers its own.
  - `OcrCache.clear` only removes `<sha>.json` files inside `ocr/`.
- Changing "index location" in settings (`src/settings-tab.ts`) takes effect after a reload and moves nothing; the OCR cache is left behind the same way.
- `src/recents.ts` (recent searches, localStorage) is unrelated; do not reuse its storage.

## Constraints

- **Location and name:** a dedicated sub-folder of the sidecar index directory (suggested `opens/`), one file per producer whose name embeds `producerId` so the owner can be parsed back out (suggested `opens.<producerId>.jsonl`). The base name must NOT match `SHARD_RE`, `JSONL_RE`, `META_RE` or `BM25_RE` (`src/sidecar.ts`). This device writes and rewrites ONLY its own file.
- **Record:** one JSON object per line: vault-relative path + epoch ms. Unknown/invalid lines are skipped, never fatal.
- **Interface the other two tickets rely on** (an Obsidian-free class; clock and adapter injected):
  - `lastOpenedMs(path): number | undefined` — SYNCHRONOUS and O(1); it is called once per chunk in the search hot path.
  - `refresh(): Promise<void>` — a search awaits it before reading. It resolves once the in-memory view is current: in this ticket that means the persisted file is loaded (a no-op afterwards). Ticket `nid_5icqphif0kxwg5pgygti668d8_e` extends the same method to pick up changed peer files, so callers never change.
  - The store is constructed with the full `SidecarSelf` (`{ deviceId, producerId }`, `src/sidecar.ts`), not just `producerId`: ticket `nid_5icqphif0kxwg5pgygti668d8_e` needs both to tell peers apart and must not have to touch the wiring.
  - Inside `SearchOrchestrator` the store is optional (like `ocrCache`; many tests and the test harness build the orchestrator without one). No store = no file was ever opened.
- **Do not diff against the vault file list before `app.workspace.onLayoutReady`** — the list is partial until then and the rewrite would drop live notes (`src/CLAUDE.md` Conventions). Loading may happen earlier; pruning may not.
- **Write sparingly:** batch appends behind a debounce of a few seconds. iCloud re-uploads the whole file on every change.
- Timers via `window.setTimeout` (popout-window convention, root `CLAUDE.md`).
- Startup must not wait on this: load off the critical path of `onload`.
- Do not log raw paths (structured logging only; `src/redact.ts` is the privacy control).
- Record every file type (cheap; images are indexed too), not just markdown.

## Non-goals

- Reading other producers' files (ticket `nid_5icqphif0kxwg5pgygti668d8_e`).
- Any filter, command or UI (ticket `nid_cwgsa0eizaicst9n1h2pq0wyi_e`).
- A full open history, backfill, a settings toggle, a clear-history action.
- Following renames that happen outside Obsidian.
- Moving the history when the user switches the index location (it starts empty in the new folder, like the OCR cache).
