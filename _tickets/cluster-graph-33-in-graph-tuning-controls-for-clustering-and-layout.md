---
id: nid_9hlo527pksi0x5692ysfk80k8_e
title: "Cluster graph 3/3: in-graph tuning controls for clustering and layout"
status: open
deps: [nid_7uixcj2srfixonpvnyqoabtxk_e]
links: []
created_iso: 2026-10-26T23:02:07Z
status_updated_iso: 2026-10-26T23:02:07Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_w09n6fd3gr8sk5loaes8qupqf_e
tags: [ui, cluster-graph]
---

## Goal
Let the user experiment with how results are clustered and laid out, right from the
graph, to find better defaults on a real vault. Requested by the human (2026-10-26):
controls visible from the modal graph, collapsed behind an icon. Read the plan first:
`_tickets/plan-desktop-result-cluster-graph-beside-the-search-list.md`.

## Done criteria
- A small icon button in the graph panel's corner toggles a collapsed controls popover;
  closed by default. Opening it never steals focus from the query field until the user
  clicks into a control, and ↑/↓/Enter in the query field keep working.
- Controls (each with its current value shown):
  - cluster cut — percentile of this query's pairwise similarities;
  - edges per note (k);
  - radius by rank / score;
  - force balance — at least the radial (relevance) vs link (similarity) strengths.
- Changing a control re-lays out the CURRENT results immediately (no re-search, no
  vector re-fetch).
- Values persist across Obsidian restarts in plugin settings; a "Reset to defaults"
  action restores the defaults from `nid_hbu44aygn72ow3jap8bug52oe_e`.
- Unit test: settings migration fills defaults for an older settings object without
  these fields. Real-Obsidian e2e: changing k changes the rendered edge count.
- `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e:obsidian` pass.

## Context
- The graph model (`nid_hbu44aygn72ow3jap8bug52oe_e`) takes these as options with named
  defaults; the panel (`nid_7uixcj2srfixonpvnyqoabtxk_e`) renders it.
- Settings: `src/types.ts` (`SeekerSettings`, `DEFAULT_SETTINGS`, `migrateSettings`).
  Use the `obsidian-settings` skill for the persisted-settings shape.
- Spike had sliders for cut / k / radius mode:
  `git show spike/cluster-graph:spikes/cluster-graph/viewer.html`.

## Constraints
- Controls live in the graph panel, NOT in the settings tab (the settings tab only has the
  on/off "Show result map" toggle from 2/3). WHY: tuning needs instant visual feedback.
- Slider changes should re-layout without visible lag at n = 50 (layout ≈ 20 ms; debounce
  only if needed).

## Non-goals
- Switching between different layout ALGORITHMS (e.g. pure similarity map with no query
  centre). Deferred until the knobs show the current layout is the limit.
- Per-vault presets, import/export of tuning values.
