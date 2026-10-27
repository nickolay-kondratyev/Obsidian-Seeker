---
id: nid_z4vwfvotr3lfmjs4ke2ud6isa_e
title: "Similar notes side panel (epic)"
status: open
deps: [nid_v1vtt1ef2cthf4282d4d0zzji_e, nid_wm12ctak5r5qitd9kiygxl9j8_e, nid_z7x18wky7wffjdgkyf8n7fk5z_e]
links: []
created_iso: 2026-10-27T00:24:53Z
status_updated_iso: 2026-10-27T00:24:53Z
type: epic
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [similar-notes, cluster-graph]
---

## Goal
Requested by the human (2026-10-26): a side panel that shows the notes most similar to the note you are currently looking at, clustered as a graph (the same cluster-graph look as the search modal's result map). No model call is needed: every note's chunk vectors are already stored, and the existing whole-vault candidate scan (`src/search.ts` `search()`) already does "one vector vs every chunk".

## Human requirements (all must hold when the epic closes)
1. Panel shows notes similar to the ACTIVE note, as a cluster graph, and follows the active note as it changes.
2. The similarity computation is a user-visible setting with two modes:
   - **Best chunk match** (default): each chunk of the active note is searched separately; a candidate note's score is its best (max) chunk-to-chunk cosine.
   - **Average**: the active note's chunk vectors are averaged into one query vector; one scan.
3. Computation runs ONLY while the panel is visible (collapsed sidebar / hidden tab ⇒ no work); becoming visible catches up to the current active note.
4. The panel's graph-look settings are persisted SEPARATELY from the search modal's `resultMapTuning`.
5. A separate command opens the panel.

## Plan
- 1/3 `nid_v1vtt1ef2cthf4282d4d0zzji_e` — similarity core on `SearchOrchestrator` (dense-only, both modes) + an index-changed signal. Independent.
- 2/3 `nid_wm12ctak5r5qitd9kiygxl9j8_e` — behavior-preserving refactor so the map painter + tuning popover can be hosted outside the search modal. Independent; can run beside 1/3.
- 3/3 `nid_z7x18wky7wffjdgkyf8n7fk5z_e` — the side panel view, command, settings, visibility gating, e2e, docs. Depends on 1/3 + 2/3.

## Decisions made by the orchestrator (see `_agent_decisions/needs_review/similar-notes-decisions.md`)
- Default mode = Best chunk match (the human said it "makes sense").
- The panel shows the graph AND a compact ranked list under it: graph titles show only on hover/selection (`nid_vkm6qs801f3zlucklfofwnoyn_e`), so a list is the only way to scan names at a glance. List works everywhere; graph is desktop-only like the result map.
- Dense-only similarity (no BM25 / recency / title boost): those are query-text signals and meaningless note-to-note.

## Non-goals
- Showing similarity inside Obsidian's core graph view, backlinks pane, or as inline suggestions.
- "Similar to a selection / paragraph" (only whole active note).
