---
closed_iso: 2026-11-20T18:18:12Z
id: nid_cwgsa0eizaicst9n1h2pq0wyi_e
title: "Opened 2/3: opened-after: search filter + 'opened today' / 'opened in last 7 days' commands"
status: closed
deps: [nid_aqto46kr20cwc4w3ry61b851l_e]
links: [nid_nse92c0xs982hhwlqzbn73868_e]
created_iso: 2026-11-20T16:42:22Z
status_updated_iso: 2026-11-20T18:18:12Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_8mpjxf78jw4ita3azfwijr4g8_e
tags: [opened-filter]
---


Part 2 of 3 of feature `nid_8mpjxf78jw4ita3azfwijr4g8_e` (read its "Decisions" section first; they are settled). Builds on the open-history store from ticket `nid_aqto46kr20cwc4w3ry61b851l_e`.

## Goal

The user can narrow any search to notes they opened on or after a date, by typing `opened-after:` or by running one of two palette commands that open the search modal already filtered to "opened today" or "opened in the last 7 days".

## Done criteria

Filter:
- `opened-after:2026-11-01`, `opened-after:2026-11`, `opened-after:7d` and `opened-after:0d` (= today) bind as a filter. The value grammar, validation and lower-bound semantics are exactly those of the existing `after:` (same parsing helpers, so the two cannot drift).
- An unparseable value (`opened-after:yesterday`) stays plain search text, like `after:yesterday` does today.
- A file passes when its last-opened time is at or after the bound. A file with no recorded open never passes.
- It combines (AND) with search text and with every existing filter (`#tag`, `path:`, `[key:value]`, `after:`, `-term`).
- `opened-after:` never also binds the existing `after:` filter and is never read as `-term` negation; existing `after:` / `before:` behaviour is unchanged; `after:` and `opened-after:` in one query each bind their own bound (tests).
- The first search after startup does not wrongly return nothing because the open-history file has not loaded yet: a search whose query has `opened-after:` awaits the store's `refresh()` before matching. Searches without the filter do not await it.

Search field UI (`src/query-field.ts`):
- `opened-after:` is offered by the operator menu with a plain-language hint (e.g. "opened on/after a date · 7d = last 7 days"), and the menu stays open while the user types through the hyphen (`opened-`). The hint is NOT prefixed with the Recency date-field name the way the `after:` / `before:` hints are.
- After typing `opened-after:` the value menu offers "today", "last 7 days", "last 30 days"; picking one commits a pill showing the absolute date, same as an `after:` pill. A typed span commits as its absolute date.
- An uncommittable value behaves like an uncommittable `after:` value.
- A committed pill serializes back to an `opened-after:` token the parser binds.

Ordering:
- A query that is ONLY filters and includes `opened-after:` lists results most-recently-opened first. With search text, ranking is unchanged. Filter-only queries WITHOUT `opened-after:` keep today's order.

Commands (`src/main.ts`):
- "Search: opened today" opens the modal filtered to files opened since local midnight today.
- "Search: opened in last 7 days" opens it filtered exactly as `opened-after:7d` would.
- Both are always available (no active file needed). The filter is seeded as editable text in the search field, exactly like "Search in current folder" seeds `path:`.
- The comment in `src/main.ts` listing "the only commands Seeker adds" is updated.

Tests and docs:
- Unit tests colocated with the touched modules (parser, matcher, field/presets, ordering), clock injected. One scenario test through the real search path, modelled on `src/date-filter.test.ts`.
- One real-Obsidian e2e in `e2e/search.e2e.ts`: open a note, run the "opened today" command, assert that note is listed and a note that was never opened is not. `docs/e2e-obsidian.md` "What the suite covers" gains the entry.
- `README.md`: the filter table gets an `opened-after:` row and the Commands table gets the two commands. Keep the absolute-GitHub-URL link convention.
- `npm run test`, `npm run typecheck` and `npm run test:e2e:obsidian` pass.

## Context

- Parser + matcher: `src/query-parser.ts` — `INLINE_FILTER_RE`, `NEGATION_RE`, `parseQuery`, `compileMatcher`, `resolveRelativeDate`, `folderScopeQuery`. Read the header comment and the long comment above `INLINE_FILTER_RE` (the leading-boundary rule for bare-prefix operators) before adding an alternative. Today `opened-after:7d` is plain text: the `after:` alternative needs start-of-string or whitespace right before it, and the negation pass needs a LEADING `-`. Relative spans resolve only when a `FilterContext` is passed (it carries the clock). The module is PURE (no `obsidian` import) and must stay so.
- Every query inlet (the modal, the `obsidian://seeker?query=…` deep link, the CLI handler) passes the raw string to `SearchOrchestrator.search`, so binding the filter there covers all of them.
- The store: `SearchOrchestrator` holds it (wired by ticket `nid_aqto46kr20cwc4w3ry61b851l_e`; read the delivered module for the member name). It is optional there; with no store, `opened-after:` matches nothing.
- "Today" needs no new grammar: `resolveRelativeDate('0d', nowMs)` already returns today's local date, and a bare date bound is read as LOCAL midnight (`parseDateMs` in `src/fusion.ts`).
- Filter types: `QueryFilters` and `FilterContext` in `src/types.ts`. `FilterContext` is built per search by `buildFilterContext()` in `src/search.ts` and already carries `nowMs`, `dateField` and `numericKeys` — it is how per-search runtime data reaches the pure matcher. `search.ts` is the only non-test caller of `parseQuery` / `compileMatcher`.
- Last-opened time is note-level, device-side data. It is NOT in chunk metadata and must not be added to the index (it changes on every open; the index is content-derived and synced). The matcher gets it by `chunk.note_path` through `FilterContext`. Consequence: only INDEXED files can be listed; an opened file Seeker does not index never shows.
- Filter-only ordering: the "Filter-only fast path" block in `SearchOrchestrator.search` (`src/search.ts`) calls `browseOrder` (`src/fusion.ts`), which sorts by the Recency date.
- Pills and menus: `src/query-field.ts` — `PillOp`, `TOK_RE`, the `OPS` operator registry, `opHint`, `serializeToken`, `canCommit`/`commit`, `datePresets`, `datePillValue`, `relativeSpanHint`. The operator-keyword completion stage only recognises pure-alphabetic runs today (`/^[a-zA-Z]+$/`); `opened-after` contains a hyphen. `datePresets` today returns last 7 / 30 / 90 days, this month, this year, last year, the year before — not the list this filter wants, and it has no "today" row.
- Seeding the field: `openSearchModal(initialQuery)` in `src/main.ts` → `PillQueryField.setQuery` (`src/query-field.ts`), which drops the raw string into the editable as TEXT (no pill is built; pills form as the user edits). `search-in-current-folder` in the `this.addCommand` block of `src/main.ts` is the precedent.
- Cold start: the modal holds every query, filter-only ones included, until the embedding model has loaded (`runSearch` in `src/search-modal.ts`). The two commands inherit that.
- Log privacy: `src/redact.ts` treats the whole `filters` subtree of a search log entry as user vocabulary (`VOCAB_SUBTREE_KEYS`), so a new `QueryFilters` field is redacted without a code change — do not add a leaf list.
- e2e precedent: test "e1" in `e2e/search.e2e.ts` (the `after:` preset through the real menu) and its fixtures in `e2e/obsidianHarness.ts`. The suite is ONE serial run in one Obsidian launch and earlier tests open notes (e.g. "e. Enter opens the top result", the similar-notes tests), so pick the "never opened" note as one no test opens, and place the test after the full reindex (test "c").
- Related open tickets: `nid_nse92c0xs982hhwlqzbn73868_e` (Obsidian e2e for query filters; plans an `extraFixtures` harness option — reuse it if it has landed, otherwise do not build it here) and `nid_k4d00kla5xlyswcy9oe99kkq0_e` (a `path:` parsing bug in the same `parseQuery`; expect a merge conflict, no logic overlap).

## Constraints

- Reuse the existing date helpers for the value; do not write a second date parser.
- Read last-opened times only through the store's synchronous `lastOpenedMs(path)` and await only its `refresh()` (ticket `nid_aqto46kr20cwc4w3ry61b851l_e`). Do not edit the store module or how `src/main.ts` creates it: ticket `nid_5icqphif0kxwg5pgygti668d8_e` changes it in parallel, and the filter must keep working unchanged when the lookup starts returning cross-device times.
- Do not edit `src/bm25.ts`, `src/tokenize.ts` or `src/prop-normalize.ts`: any change there refits every user's BM25 index (root `CLAUDE.md` Global invariants). `src/query-parser.ts` is not in that set.
- No `DB_VERSION` / index-identity bump: nothing persisted in the index changes.
- Command ids are auto-prefixed by Obsidian with the plugin id — do not repeat it. Run `node scripts/rename-plugin-id.mjs --check` (part of `npm run test`).

## Non-goals

- `opened-before:`, an `opened:` alias, word values like `today`/`yesterday` in the typed grammar (the "today" menu row and command cover it).
- A ranking boost by last-opened, a sort toggle, new settings.
- Reading other devices' files (ticket `nid_5icqphif0kxwg5pgygti668d8_e`).
- Building general e2e fixtures for other filters (ticket `nid_nse92c0xs982hhwlqzbn73868_e`).
- Seeding the commands' filter as a ready-made pill, or any change to how `setQuery` seeds the field.
- Skipping the model-load wait for filter-only queries.
