# Result map: wider modal and draggable list/map divider

Context: ticket `nid_81bbpf6v0cp9ubnyvlgahgzzg_e` (`src/result-map-divider.ts`, `src/result-map-panel.ts`).

## 1. Persist the LIST width, not the map width
- Decision: the divider stores `resultMapListWidthPx`; the map takes the rest.
- Why: the default keeps today's 640px list, and the map gets all extra space as the modal grows.

## 2. Modal capped at `min(1600px, 94vw)`
- Decision: the modal stops growing at 1600px.
- Why: on ultra-wide screens an uncapped modal stretches the graph into a thin, wide strip.

## 3. Width stored in synced `data.json`, not per-device storage
- Decision: `resultMapListWidthPx` lives in settings like `resultMapTuning`, so it syncs across devices.
- Why: KISS, one settings path. CSS shrinks the list on smaller screens, so a width saved on a big screen still fits.
- Alternative not taken: per-device local storage (more code for a small gain).

## 4. Double-click on the divider resets the width (not requested)
- Decision: double-click restores the default list width.
- Why: cheap, familiar escape hatch after a bad drag. Easy to remove if unwanted.

## 5. Known pre-existing gap left as-is
- Shrinking the window below `MIN_WINDOW_WIDTH_FOR_MAP_PX` while the map shows keeps the map until the next search (width is checked once per result set).
- Why: pre-existing behavior (see cluster graph 2/3 §3), out of scope here.

# Result map: titles only on hover/selection

Context: ticket `nid_vkm6qs801f3zlucklfofwnoyn_e`.

## 1. Pinned-label unit tests deleted
- Decision: the unit tests for pinned (always-visible) node labels were deleted, not rewritten.
- Why: that behavior was removed on your request (titles now show only when a node is hovered or selected); the tests described behavior that no longer exists.
