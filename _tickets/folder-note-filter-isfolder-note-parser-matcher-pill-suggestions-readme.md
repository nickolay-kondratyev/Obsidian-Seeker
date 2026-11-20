---
id: nid_pse843v9nyfby1bp9arliem22_e
title: "Folder-note filter: is:folder-note (parser, matcher, pill, suggestions, README)"
status: open
deps: []
links: []
created_iso: 2026-11-20T23:43:12Z
status_updated_iso: 2026-11-20T23:43:12Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [filter-ui]
---


## Goal

Add a query filter that keeps only **folder notes**: notes whose name matches the folder they sit in (`Projects/Alpha/Alpha.md`). People who organise a vault with folder notes want to jump straight to those "hub" notes; today no filter can express that. The filter is typed as `is:folder-note` and behaves like every other inline filter (pill, suggestions, combines with other filters). A follow-up ticket (nid_il90ju34g89e14fhf18ms7h28_e) exposes it as a clickable row in a filter menu; this ticket delivers the filter itself.

Design decisions for the whole feature are recorded in `_agent_decisions/needs_review/filter-ui-and-folder-note-filter.md` — read it first.

## Definition (decided — do not re-open)

A result is a folder note when ALL hold, judged from the chunk's `note_path` alone:

- The path has a parent folder (a vault-root file such as `Alpha.md` is never a folder note).
- The file name minus its LAST extension equals the IMMEDIATE parent folder's name, compared case-insensitively (`projects/alpha/Alpha.md` counts; `v1.2/v1.2.md` counts).
- The extension is `md`, `canvas` or `base` (case-insensitive). Images never count (`Alpha/Alpha.png` is a screenshot, not a note).
- Only the "note INSIDE the folder" style is supported. `Projects/Alpha.md` sitting beside a `Projects/Alpha/` folder is NOT a folder note (explicit human requirement).

It is computed at query time from the path. No index/persisted shape change, so no version-constant bump (root `CLAUDE.md` "Global invariants").

## Done criteria

- `parseQuery('is:folder-note roadmap', ctx)` (in `src/query-parser.ts`) strips the token, returns `cleanedQuery === 'roadmap'` and a `QueryFilters` (in `src/types.ts`) carrying the folder-note flag; `is:folder-note` alone yields a filter-only query (empty cleaned text), which already browses by recency in `src/search.ts`.
- The value binds case-insensitively (`is:Folder-Note`). An unknown value (`is:banana`) is NOT a filter: it stays in the text verbatim, exactly like an unparseable `after:yesterday` does today. Mid-word text (`this:folder-note`, `analysis:folder-note`) does not bind (same leading-boundary rule as `tag:`/`path:`).
- `compileMatcher` rejects every chunk that is not a folder note per the Definition, and ANDs with all other filters (`is:folder-note path:"Projects/*" #active` keeps only folder notes under Projects tagged active).
- In the modal's query field (`src/query-field.ts`): typing `is` offers the `is:` operator with a plain-language hint; `is:` offers the `folder-note` value row with a hint that shows the shape (e.g. `Alpha/Alpha.md`); Space/Enter/row-accept on `is:folder-note` commits a removable pill that serializes back to `is:folder-note`; an unknown `is:` value does not commit a pill (stays text, like an invalid date). Committing it twice does not create a second identical pill.
- Unit tests (vitest, colocated, GIVEN/WHEN/THEN, one behaviour each) cover: the parser cases above; the matcher for each Definition bullet (root file, case difference, dotted name, each allowed extension, image rejected, note-beside-folder rejected, nested deeper folder, composition with another filter); the pill/suggestion behaviour in `src/query-field.test.ts`. Start from a failing test.
- Diagnostics: check `src/redact.ts` (the `filters` subtree is redacted as user vocabulary) — the new field must not break redaction or its tests; keep the flag legible if it carries no user content.
- `README.md` "Filters" table gains a row for the filter with the in-folder definition stated in user terms and the "note next to the folder does not count" caveat. Header comment of `src/query-parser.ts` ("Supported operators") and of `src/query-field.ts` updated.
- `npm run typecheck` and `npm run test` pass. `change_log` entry added.

## Context

- `src/query-parser.ts` — pure parser + matcher. `INLINE_FILTER_RE` holds the bare-prefix alternatives inside the `(?:^|\s)` boundary group; `opened-after:` is the most recent addition and the pattern to copy (see closed ticket nid_8mpjxf78jw4ita3azfwijr4g8_e via `ticket show`). `nothingExtracted` must learn the new field or the filter is silently dropped.
- `src/types.ts` — `QueryFilters`, `FilterContext`.
- `src/query-field.ts` — `PillOp`, `OPS`, `TOK_RE`, `matchingOps`, `serializePill`, `derive()` value stage, `pendingCommit`/`canCommit`/`commit`. Tests in `src/query-field.test.ts`, `src/query-parser.test.ts`, `src/opened-filter.test.ts` (scenario style).
- `src/search.ts` — `search()` calls `parseQuery` → `compileMatcher` → `buildSelectionMask`; should need no change, verify. Confirm that OCR image documents carry the image's own path in `note_path` (so the extension rule excludes them).
- Negated operators (`-is:folder-note`) are already dropped by the negation pass (anything with `:`); leave that as is.

## Constraints

- Token is exactly `is:folder-note` (ticket nid_il90ju34g89e14fhf18ms7h28_e emits it). `is:` is a namespace: structure the parser/pill so another `is:` value could be added later, but add none now.
- `src/query-parser.ts` stays pure (no `obsidian` import).
- No lookbehind in regexes (old iOS WKWebView; see the `NEGATION_RE` comment).

## Non-goals

- The "note beside the folder" style, or any setting to choose a style.
- Reading the Folder Notes plugin's configuration; custom folder-note names (`index.md`, `_about.md`).
- A negated form (`-is:folder-note`), other `is:` values.
- Unicode normalisation beyond what Obsidian paths already have.
