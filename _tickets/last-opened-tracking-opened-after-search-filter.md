---
closed_iso: 2026-11-20T18:25:56Z
id: nid_8mpjxf78jw4ita3azfwijr4g8_e
title: "Last-opened tracking + opened-after: search filter"
status: closed
deps: [nid_aqto46kr20cwc4w3ry61b851l_e, nid_cwgsa0eizaicst9n1h2pq0wyi_e, nid_5icqphif0kxwg5pgygti668d8_e]
links: []
created_iso: 2026-11-20T16:42:21Z
status_updated_iso: 2026-11-20T18:25:56Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [opened-filter]
---


## Goal

Let the user find notes by when they last looked at them. Seeker records when each vault file was last opened, exposes that as a search filter `opened-after:`, and adds two command-palette shortcuts: "Search: opened today" and "Search: opened in last 7 days". Opens on ANY of the user's devices count.

Why not the file system: Linux `atime` is unusable for this (default `relatime` mount updates it at most once per 24h, `noatime` never, and any reader — Seeker's own indexer, sync, backups — bumps it). Obsidian's `TFile.stat` exposes no access time at all. So the plugin records opens itself.

## Tasks (this ticket depends on all three)

1. `nid_aqto46kr20cwc4w3ry61b851l_e` — record last-opened times in a per-device open-history file.
2. `nid_cwgsa0eizaicst9n1h2pq0wyi_e` — the `opened-after:` filter, the two commands, e2e, README. Needs 1.
3. `nid_5icqphif0kxwg5pgygti668d8_e` — merge the other devices' files. Needs 1. Independent of 2.

Tickets 2 and 3 can run in parallel: ticket 1 fixes the store's interface (`lastOpenedMs(path)` + `refresh()`) and its wiring (`src/main.ts` creates it and hands it to `SearchOrchestrator`). Ticket 2 only calls it and never edits the store module; ticket 3 edits only the store module.

## Done criteria

- All three task tickets are closed.
- On a real vault: open an indexed note, run "Search: opened today" → that note is listed first; a note never opened since the feature shipped is not listed.

## Decisions (settled with the human 2026-11-20 — do not re-open without them)

- **Cross-device: yes.** A note opened on the phone shows under "opened today" on desktop.
- **Storage:** one append-only file per producer (device + vault) inside the Seeker sidecar index directory (the folder that already holds `ocr/`). NOT IndexedDB (a full reindex wipes the index DB; iOS evicts IndexedDB) and NOT `data.json` (one shared file that sync clobbers). One writer per file makes sync conflicts structurally impossible. Written even when the sidecar setting is off, like the OCR cache.
- **Only the LAST open per file is kept**, not a full history. The file is periodically rewritten to one line per path, so its size is bounded by the number of files ever opened, not the number of opens.
- **Key = vault-relative path** (Obsidian has no stable file id). Value = epoch milliseconds.
- **"Opened" means the file became the active file** (the user opened it or switched to its tab). Not hover previews, not background tabs restored at startup, not Seeker's indexing reads.
- **Renames inside Obsidian keep the time** (new "Untitled" note that gets renamed is still "opened today"). Renames done outside Obsidian lose it — accepted.
- **No backfill.** History starts when the feature ships.
- **"Today" = from local midnight of the device running the search. "Last 7 days" = today plus the 7 days before it** — identical to the existing `after:7d`.
- **Never-opened files never match `opened-after:`.**
- **Filter name `opened-after:`**, same value grammar as `after:` (absolute date or a `7d`/`2w`/`3m`/`1y` span).
- **Filter-only queries with `opened-after:` are ordered most-recently-opened first**; with search text, normal ranking.

## Non-goals (whole feature)

- `opened-before:`, a full open history ("opened between X and Y" when reopened later), a ranking boost by last-opened.
- A settings toggle, a "clear history" button, or any settings UI.
- Backfill from `atime` or from Obsidian's recent-files list.
- Following renames done outside Obsidian.

## Closing note (2026-11-20, orchestrator)

All three task tickets merged to main (`2086143`, `698f6b1`, `ef84b45`). The real-vault criterion is covered by real-Obsidian e2e `e1b` in `e2e/search.e2e.ts` (open a note → "Search: opened today" lists it; a never-opened note is not listed); "listed first" ordering is covered by `browseByLastOpened` unit tests in `src/fusion.test.ts`. Not hand-checked on the human's own vault.
