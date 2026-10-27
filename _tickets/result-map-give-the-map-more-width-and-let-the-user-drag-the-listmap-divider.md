---
closed_iso: 2026-10-27T00:19:52Z
id: nid_81bbpf6v0cp9ubnyvlgahgzzg_e
title: "Result map: give the map more width and let the user drag the list/map divider"
status: closed
deps: []
links: []
created_iso: 2026-10-27T00:08:26Z
status_updated_iso: 2026-10-27T00:19:52Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [ui, cluster-graph, result-map-ux]
---

## Goal
Requested by the human (2026-10-26): give the result map more WIDTH; making it draggable (resizable) is preferred, but at minimum use more of the available window width.

## Current state
- `styles.css` result-map section: `.seeker-modal.seeker-has-map.modal { width: min(1040px, 94vw) }` and `.seeker-map { flex: 0 0 400px }` (640px list + 400px map). `MIN_WINDOW_WIDTH_FOR_MAP_PX = 1120` in `src/result-map-panel.ts` guards that the list never narrows below 640px.
- The panel measures its canvas after paint (`measure()` in the loader deps) and lays the graph out for that size; tuning changes already re-lay out from kept vectors without re-search/re-fetch (`src/result-map-tuning.ts`, `ResultMapPanel`).

## Done criteria
- When the map shows, the modal uses noticeably more of the window width (e.g. up to ~94vw on wide screens), and the extra width goes to the map, not the list. Map-less states keep today's modal width.
- A drag handle on the list/map divider lets the user resize the map with the mouse (cursor `col-resize`, visible hover affordance). Clamped so the list keeps a usable minimum and the map keeps a minimum; the chosen width survives closing/reopening the modal (persist it; follow existing settings/persistence patterns, settings migration only if the repo pattern needs it).
- After a resize ends (and on modal resize if cheap), the graph re-lays out for the new canvas size from the kept vectors (no re-search, no vector re-fetch). Do not re-lay out on every pointermove if that is janky; on drag end is fine.
- Dragging never steals focus from the query field; ↑/↓/Enter keep working after a drag.
- Keep `MIN_WINDOW_WIDTH_FOR_MAP_PX` and its comment consistent with the new widths.
- Pure parts (width clamping, persisted-width handling) unit-tested; one real-Obsidian e2e key journey for dragging the divider (asserts the map got wider / re-laid out, no CSS/look assertions). Run only the result-map e2e specs in the lane.
- Popout-window convention: `activeWindow` / `window.setTimeout`, never bare globals (root `CLAUDE.md`).

