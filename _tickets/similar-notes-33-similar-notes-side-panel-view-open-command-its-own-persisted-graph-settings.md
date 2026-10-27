---
id: nid_z7x18wky7wffjdgkyf8n7fk5z_e
title: "Similar notes 3/3: similar-notes side panel view + open command + its own persisted graph settings"
status: open
deps: [nid_v1vtt1ef2cthf4282d4d0zzji_e, nid_wm12ctak5r5qitd9kiygxl9j8_e]
links: []
created_iso: 2026-10-27T00:24:54Z
status_updated_iso: 2026-10-27T00:24:54Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_z4vwfvotr3lfmjs4ke2ud6isa_e
tags: [similar-notes, cluster-graph]
profile: higher
---

## Goal
Ship the user-facing similar-notes panel (epic `nid_z4vwfvotr3lfmjs4ke2ud6isa_e`): an Obsidian sidebar view that follows the active note and shows the notes most similar to it as a cluster graph plus a compact ranked list, with its own persisted settings, opened by its own command. Read the epic's "Human requirements" — all five must hold.

## Done criteria
- A new command (name in user vocabulary, e.g. "Open similar notes") opens/reveals the panel in the right sidebar. This is the plugin's first `registerView`/`ItemView`.
- The panel follows the active note: switching notes re-queries via 1/3's `similarNotes`; a stale result (user switched again mid-query) is dropped (latest wins).
- Computation runs ONLY while the panel is actually visible. Hidden (collapsed sidebar, another tab in front, panel closed) ⇒ no `similarNotes` calls. Becoming visible again re-queries for the current active note if it changed while hidden. Covered by unit tests of the gating logic (keep the gating decision in a small Obsidian-free unit so it is testable).
- The panel refreshes when the index changes (1/3's index-changed signal), still subject to the visibility gate; debounce so a long reindex does not hammer it.
- Graph: centre = the active note; nodes = similar notes, closer = more similar; reuses the painter extracted in 2/3 and `buildClusterGraph`. Hover/click a node ↔ the list row; click opens the note. Desktop-only graph (like the result map); on mobile the panel shows the list only.
- Compact ranked list under the graph (note title only, no score; clicking opens the note).
- Separate persisted settings in `SeekerSettings` (`src/types.ts`), independent of the modal's `resultMapTuning`: the panel's `ClusterGraphOptions` and the similarity mode (`best-chunk` default | `average`). Loaded through `settingsFromPersisted` with `completeClusterGraphOptions` + a mode guard, like `resultMapTuning`; covered in `src/settings-migrate.test.ts`.
- Both are editable from the panel's tuning popover (the mode as a two-option control with plain labels: "Best matching section" / "Whole note average" or similar user wording, with a one-line hint each). Changing the mode re-queries; changing graph knobs re-lays out without re-querying.
- Clear empty states in plain language: no active note / note not indexed yet / index not built / no similar notes.
- Real-Obsidian e2e key journey in `e2e/search.e2e.ts` (or a sibling spec): open a note, run the command, the panel shows nodes for similar notes; switch to another note and the panel updates. No CSS/look assertions. Unit tests cover logic. `npm run typecheck`, `npm run test` green; run the new e2e spec in the lane.
- Docs: `README.md` (feature + command), `src/CLAUDE.md` UI layer line, `docs/e2e-obsidian.md` new spec, `change_log` entry.

## Context
- 1/3 `nid_v1vtt1ef2cthf4282d4d0zzji_e`: `SearchOrchestrator.similarNotes(...)`, `SimilarityMode`, index-changed signal.
- 2/3 `nid_wm12ctak5r5qitd9kiygxl9j8_e`: host-agnostic graph painter + `ResultMapLoader` + `ResultMapTuningPopover` (`src/result-map-tuning.ts`).
- `src/main.ts`: commands via `this.addCommand` (~:619; `search-in-current-folder` ~:632 uses `getActiveFile()`); existing `active-leaf-change` listener in `wireIncrementalIndexing()` (~:1506) — reuse or add a listener, don't break the existing one. `src/main.ts` re-exposes orchestrator events (e.g. `onIndexProgress` ~:2043).
- Settings precedent: `resultMapTuning` / `showResultMap` in `src/types.ts` (~:579-594, defaults ~:712-714, load ~:828) and tests `src/settings-migrate.test.ts` ~:309-364.
- `src/result-map-panel.ts` `resultMapAvailable({isMobile, ...})` for the desktop-only rule.
- Repo invariant: popout-window convention — use `window.setTimeout` / `activeWindow`, never bare timer/window globals (root `CLAUDE.md`).
- Obsidian visibility: a leaf's view can be detached, in a collapsed sidebar, or behind another tab; prefer Obsidian's own signals (`layout-change`, `active-leaf-change`, `containerEl.isShown()`) over polling.

## Constraints
- Settings are separate from the modal's (`resultMapTuning`, `resultMapListWidthPx`) — human requirement.
- Similarity mode default = `best-chunk`.

## Non-goals
- A settings-tab section for the panel (the tuning popover is the one place; add a settings-tab row only if trivially consistent with `Show result map`).
- Pinning the panel to a specific note, history, or "similar to selection".
- Panel on mobile with a graph.
