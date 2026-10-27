---
closed_iso: 2026-10-27T00:12:48Z
id: nid_vkm6qs801f3zlucklfofwnoyn_e
title: "Result map: show a node's title only when it is hovered or selected"
status: closed
deps: []
links: []
created_iso: 2026-10-27T00:08:26Z
status_updated_iso: 2026-10-27T00:12:48Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [ui, cluster-graph, result-map-ux]
---

## Goal
The result map (desktop graph beside the search list) is cluttered by always-on titles. Requested by the human (2026-10-26): do not show a node's text unless the mouse is over that node or the node is the one currently selected in the results list.

## Current state
- `src/result-map-panel.ts` §labels: `PINNED_LABEL_COUNT = 5` + `pinnedLabelIndices()` keep the top 5 titles always visible (`.seeker-map-label.is-pinned` in `styles.css`). The selected node also shows its label (`.is-selected`).
- Hovering a node already selects its row (`src/search-modal.ts` `selectFromMap`, wired via `onNodeHover`), so "hovered" and "selected" both reach the panel as the selected index.

## Done criteria
- Only the selected node's label is visible; no pinned labels. Hovering a node shows its title (via the existing hover -> select path); arrowing through the list shows the title of the selected row's node.
- Pinned-label code, CSS and tests are removed (clean break, no dead code). Update the comments in `result-map-panel.ts` and the `styles.css` result-map comment that describe pinned labels; update `src/CLAUDE.md` / docs if they mention pinned labels.
- Unit tests updated for the removed behavior; existing real-Obsidian e2e (`e2e/`) for the result map still passes (run only the result-map specs in the lane).
- No CSS/look assertions in e2e.

