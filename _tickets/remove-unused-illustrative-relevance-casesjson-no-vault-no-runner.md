---
closed_iso: 2026-09-03T17:43:12Z
session_ids: [{"a": "claude", "type": "execution", "id": "1074bafd-70a7-4fa4-bb8f-8a235a34161f"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-3
id: nid_rt7xfg6xxj02am3fqjecu0er6_e
title: "Remove unused illustrative relevance-cases.json (no vault, no runner)"
status: closed
deps: []
links: []
created_iso: 2026-09-03T17:39:49Z
status_updated_iso: 2026-09-03T17:43:12Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [cleanup, test-infra]
---

`tests/relevance-cases.json` is dead weight: hand-authored, synthetic relevance-regression cases that cannot run.

## Why remove
- **No corpus/vault.** Cases reference notes like `Notes/Project Atlas.md`, `Clippings/GraphDB.md`, `Inbox/Alex 1x1 2026-06-08.md` that do not exist anywhere in the repo. `meta.source` says they are "synthetic examples... constructed for documentation, not measurements from a specific vault" and every case is `"status": "illustrative"` (one is `"passing-ranking"`).
- **No runner.** grep for `relevance-cases` across `*.ts/*.mjs/*.js` returns zero hits. Nothing loads or asserts against this JSON.
- Numbers in each case (e.g. `dense 1.00`, observed ranks) were captured on the author's private vault and are not reproducible here.

So the file is neither an executable test nor tied to any code; it just looks like a test harness and misleads readers.

## Scope
1. Delete `tests/relevance-cases.json`. If `tests/` becomes empty, remove the directory.
2. Remove the reference in `/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-3/CLAUDE.md` (Layout section, the line: "`tests/relevance-cases.json` — illustrative relevance-regression case set (not wired into a runner).").
3. grep the repo once more for any stray references (docs, _tickets, README) and clean/adjust them.

## Note / possible follow-up
The intent behind the data (documenting known hybrid-search ranking failure modes: recency tie-breaks, unimplemented `file:` and `-[pageType:task]` operators, chunk-dilution recall misses) is genuinely useful. Before deleting, consider whether any of it should be preserved as prose in docs or converted into real `src/query-parser.test.ts` cases for the parser-operator entries (which name `vitest_target: src/query-parser.test.ts`). If preserving, do it in a separate ticket; this ticket is only the removal.

## Acceptance
- `tests/relevance-cases.json` gone; no dangling references remain (grep clean).
- `npm run test` and `npm run typecheck` still pass.

## Resolution
- Deleted `tests/relevance-cases.json` via `git rm`; the `tests/` directory
  became empty and was removed (`rmdir`).
- Removed the Layout line in `CLAUDE.md` that described the file.
- grep for `relevance-cases` across `*.ts/*.mjs/*.js/*.md/*.json` is clean of
  live references. The only remaining hit is a **historical observation** in
  `_tickets/create-claudemd-top-level-and-sub-levels.md:37` ("`tests/relevance-cases.json`
  is referenced by nothing in the repo") — that is the observation that spawned
  this cleanup, so it was left untouched rather than rewriting another ticket's
  recorded history.
- The "possible follow-up" (preserving the intent as prose/real parser tests)
  was explicitly out of scope for this removal ticket and was not done; open a
  separate ticket if desired.
- Verified: `npm run typecheck` (exit 0) and `npm run test` (1267 passed,
  6 skipped, exit 0). Note: `npm ci` had to be run first — deps were not
  installed in this environment.

