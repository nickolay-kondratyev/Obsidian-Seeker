---
id: nid_il90ju34g89e14fhf18ms7h28_e
title: "Filter menu from the search icon in the Seeker modal (click-to-add filters over the existing query syntax)"
status: open
deps: [nid_pse843v9nyfby1bp9arliem22_e]
links: []
created_iso: 2026-11-20T23:43:13Z
status_updated_iso: 2026-11-20T23:43:13Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [filter-ui]
---


## Goal

Seeker's filters (`tag:`, `path:`, `[key:value]`, `after:`/`before:`, `opened-after:`, `is:folder-note`) only work if you already know the syntax. Make them discoverable: clicking the search icon at the left of the Seeker search pop-up opens a menu of the available filters; picking one adds that filter without the user typing or knowing any syntax.

Design decisions for the whole feature are recorded in `_agent_decisions/needs_review/filter-ui-and-folder-note-filter.md` — read it first. The core decision: the menu is a BUILDER over the existing query syntax. Picking a row produces the same tokens/pills the user could have typed, so the query string stays the single source of truth (deep links, recents, `parseQuery`, logging all keep working with zero parallel filter state).

## Done criteria

- Clicking/tapping the search icon in the modal opens a filter menu; clicking it again, pressing Esc, or typing closes it (Esc closes the menu, not the modal). The icon reads as clickable (hover/pressed state, tooltip + `aria-label` such as "Add filter") and keeps its existing model-ready dimming (`PillQueryField.setModelReady`). The menu opens whether or not the model is ready (the dimmed resting state must not make the icon inert).
- The menu lists, in this order, with a plain-language label first and the syntax it stands for as secondary text (so it also teaches the syntax):
  - Tag (`tag:`), Folder (`path:`), Property (`[key:value]`)
  - Date on/after (`after:`), Date on/before (`before:`) — labelled with the vault's actual date field, as `operatorHint` does today
  - Opened on/after (`opened-after:`)
  - Folder notes only (`is:folder-note`)
- Picking a row that needs a value (all but the last) starts that filter and immediately shows the value choices that typing the operator already shows today (tags, folders, property keys then values, date presets, opened presets). Picking a value commits the usual pill. Free typing of a value still works.
- Picking "Folder notes only" commits the `is:folder-note` pill directly; if that pill is already present nothing is duplicated.
- Picking from the menu NEVER changes or removes text the user already typed (GIVEN `meeting notes` typed, WHEN Tag → a tag is picked, THEN the query is the tag pill plus `meeting notes`). Note the existing operator-row accept replaces the trailing word; the menu path must not.
- After any menu interaction the query field has focus with a visible caret, and the menu is fully usable by keyboard once open: ↑/↓/Enter/Tab act on the menu IMMEDIATELY, without first hovering or pressing an arrow (the user opened it on purpose). Works on mobile (tap) as well as desktop; the icon's tap target is comfortably finger-sized (grow the hit area with padding, not the glyph).
- Typing behaviour without the menu is unchanged: existing `src/query-field.test.ts` tests pass unmodified.
- Unit tests (vitest, `src/query-field.test.ts`, GIVEN/WHEN/THEN, one behaviour each) cover the menu's logic: rows offered, a value-row pick leading to the value menu, the direct folder-note commit and its no-duplicate rule, typed text preserved, open/close toggling. Keep menu-building logic in pure exported functions where that makes it testable without DOM.
- One real-Obsidian e2e journey in `e2e/search.e2e.ts` (see `docs/e2e-obsidian.md`; fixture notes are added in `e2e/obsidianHarness.ts` the way `DATE_FILTER_NOTES` are): open search → click the search icon → pick "Folder notes only" → the fixture folder note (`<Name>/<Name>.md`) is listed and a non-folder-note fixture sharing its distinctive token is not. Type the shared token FIRST and assert both fixtures show (guards against a vacuous pass, as test `e1` does), then use the menu; the token must still be in the query afterwards. No CSS/look assertions. Fixture notes change the vault's note count: `VAULT_NOTE_COUNT` in `e2e/search.e2e.ts` is derived from the fixture lists and must stay correct. `npm run test:e2e:obsidian` passes.
- `README.md`: the Filters section says filters can be added by clicking the search icon (and the feature bullet near the top mentions it); refresh a screenshot under `docs/images/` only if an existing one becomes misleading. `src/CLAUDE.md` UI line updated only if a new module is added.
- `npm run typecheck`, `npm run test`, `npm run build` pass. `change_log` entry added.

## Context

- `src/query-field.ts` — `PillQueryField`. The icon is `magEl` (`.seeker-mag`, `setIcon(…, 'search')`), today a non-interactive glyph: the row-level `mousedown` handler on `rootEl` just focuses the editable. The suggestion dropdown (`suggEl`, `SuggestState`, `MenuItem` with `op` / `value` / `text` rows, `derive()`, `accept()`, `commit()`, `renderSugg()`, `menuEngaged`) already implements everything after "an operator was chosen". Pitfalls verified in review: (1) `refresh()` re-derives the dropdown from the editable's text on every input, so the icon-opened menu is state that `derive()` does not produce — it must survive until a pick/close and be dropped on typing; (2) an `op`-kind dropdown ignores ↑/↓/Enter until `menuEngaged` is set (so typing `a` does not hijack result navigation) — the icon-opened menu must start engaged; (3) `accept()` of an `op` row REPLACES the trailing word and `commit()` cuts the trailing token, so a menu pick must add its operator as a NEW trailing token (and the direct folder-note commit must cut nothing) to keep typed text; (4) the `rootEl` `mousedown` handler already `preventDefault`s + focuses the editable for a press on the icon — keep that, it is what stops the field from blurring. Read the file's header comment on caret discipline (uncontrolled contenteditable) before changing anything.
- `src/suggest.ts` — `SuggestEngine.listSuggestions` supplies tag/folder/property rows.
- `src/search-modal.ts` — constructs the field (`new PillQueryField(contentEl, …)`).
- `styles.css` — `.seeker-q`, `.seeker-mag`, `.seeker-sugg*`.
- Load the `my-frontend-design` skill before UI work.
- Depends on nid_pse843v9nyfby1bp9arliem22_e for the `is:folder-note` token and pill.
- Related, not overlapping: nid_nse92c0xs982hhwlqzbn73868_e (e2e coverage of typed filters) — do not absorb it.

## Constraints

- Reuse the field's existing suggestion dropdown for the menu (decided: one surface, focus never leaves the editable, the value step appears in the same place, already works on mobile). Do NOT introduce Obsidian's `Menu` or a second popover; rationale in the decision doc.
- No parallel filter state: every pick ends as text in the editable or a pill in `tokens`, serialised by `serializePill`.
- Popout-window convention (root `CLAUDE.md`): `activeWindow` / `activeDocument` / `window.setTimeout`, never bare globals.
- Prefer CSS over JS for the icon's hover/pressed states; respect the existing `.seeker-mag` vertical alignment.

## Non-goals

- Editing an existing pill through the menu (remove with × / Backspace and re-add).
- Submenus, a date picker widget, multi-select, saved filters, a new hotkey for the menu.
- Negation or other syntax not already pill-capable.
- Changes to `parseQuery`/matching.
