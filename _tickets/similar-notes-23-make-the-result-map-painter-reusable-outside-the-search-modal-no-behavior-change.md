---
id: nid_wm12ctak5r5qitd9kiygxl9j8_e
title: "Similar notes 2/3: make the result map painter reusable outside the search modal (no behavior change)"
status: in_progress
deps: []
links: []
created_iso: 2026-10-27T00:24:54Z
status_updated_iso: 2026-10-27T00:26:14Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_z4vwfvotr3lfmjs4ke2ud6isa_e
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1/.worktree/t-wm12ctak
tags: [similar-notes, cluster-graph]
---

## Goal
The similar-notes side panel (epic `nid_z4vwfvotr3lfmjs4ke2ud6isa_e`, ticket 3/3) must paint the same cluster graph and offer the same tuning popover as the search modal's result map, but hosted in an Obsidian sidebar view. Today `ResultMapPanel` mixes the reusable graph painter with modal-only concerns. Split them so the sidebar can reuse the painter without copying it. Pure refactor: the search modal must look and behave exactly as before.

## Done criteria
- A host-agnostic graph component (painter: SVG nodes/edges/centre node, hover/click/selection, title-on-hover/selected labels, tuning popover button) can be constructed with just a parent element + callbacks, without a modal element, query field, or list/map divider.
- The centre-node meaning and caption text are supplied by the host (modal: query-centred "Nearer the centre = more relevant"; sidebar will say the centre is the active note).
- The search modal uses the extracted component; all modal-specific pieces (`seeker-has-map` class on the modal, `ListMapDivider`, focus-to-query-field behavior, `MIN_WINDOW_WIDTH_FOR_MAP_PX` fit check) stay with the modal side.
- `ResultMapLoader` usable by another host (it already is nearly host-agnostic; keep it so).
- No behavior change: existing unit tests green unchanged; real-Obsidian e2e result-map specs e2/e3/e4 in `e2e/search.e2e.ts` green (`npm run test:e2e:obsidian`, run only those specs in the lane). `npm run typecheck` green.

## Context
- `src/result-map-panel.ts`: `ResultMapPanel(parent, modalEl, callbacks)`; `ResultMapCallbacks` (`onNodeHover`, `onNodeClick`, `fetchVectors`, `reportFailure`, `tuning`, `setTuning`, `listWidth`, `setListWidth`, `persistSettings`, `focusQuery`); `ListMapDivider` created inside the panel ctor; `modalEl` only toggles `seeker-has-map`; a mousedown handler keeps focus in the query field; private `paint()`.
- `src/result-map-tuning.ts`: `ResultMapTuningPopover(buttonParent, popoverParent, deps: {current, update, persist, restoreFocus})` — already generic.
- `src/result-cluster-model.ts`: pure model, unchanged by this ticket.
- `src/search-modal.ts` ~:429-446: modal wiring of the panel and `selectedIndex`.
- `styles.css` result-map section: `.seeker-map-*` classes. Sidebar will need the painter's styles to work outside `.seeker-modal`; keep selectors that style the painter host-agnostic (modal layout selectors stay modal-scoped).
- `docs/e2e-obsidian.md` describes e2/e3/e4.

## Constraints
- Refactor only — no visible change in the modal. Keep it in refactor commits separate from anything else.
- Composition, not inheritance (repo convention).

## Non-goals
- The sidebar view itself, its settings, its command (ticket 3/3).
- New graph features.
