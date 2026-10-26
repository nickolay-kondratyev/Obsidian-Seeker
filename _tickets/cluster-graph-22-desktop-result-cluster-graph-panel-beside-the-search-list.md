---
id: nid_7uixcj2srfixonpvnyqoabtxk_e
title: "Cluster graph 2/3: desktop result-cluster graph panel beside the search list"
status: open
deps: [nid_hbu44aygn72ow3jap8bug52oe_e]
links: []
created_iso: 2026-10-26T22:56:28Z
status_updated_iso: 2026-10-26T22:56:28Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_w09n6fd3gr8sk5loaes8qupqf_e
tags: [ui, cluster-graph, e2e]
---

## Goal
On desktop, the search modal shows the result-cluster graph to the RIGHT of the result
list, linked to the list's selection, so the user sees at a glance which results belong
together and how relevant each is. Uses the graph model from
`nid_hbu44aygn72ow3jap8bug52oe_e`. Read the plan first:
`_tickets/plan-desktop-result-cluster-graph-beside-the-search-list.md`.

## Done criteria
- Desktop, wide enough window: after a query, a graph panel appears right of the list
  with one node per graphable result, a central query node, cluster colours, kNN edges.
  Title-only (`lexicalOnly`) results appear as grey unclustered nodes.
- The list renders exactly as fast as today: vectors + layout run after the list has
  painted, never before.
- A newer query never shows an older query's graph (stale results dropped).
- Linked selection both ways: ↑/↓ or hovering a row highlights its node and that node's
  edges; hovering a node selects its row (scrolling it into view); clicking a node opens
  the note exactly as clicking its row does.
- Mobile (`isMobilePlatform()` in `src/platform.ts`): no graph DOM and no vector fetch.
- Window narrower than a named minimum width: no graph; the modal keeps today's width
  (`min(640px, 94vw)`, `styles.css` `.seeker-modal.modal`).
- Empty / onboarding / no-results / recents states show no graph.
- Looks native in light and dark themes (Obsidian CSS variables only; no hard-coded
  colours except a cluster palette that reads on both).
- Hover on a node shows the note title (tooltip or label); top few nodes are labelled.
- Settings tab: a desktop-only "Show result map" toggle, default ON (human-approved
  2026-10-26); off → no graph, no vector fetch, today's modal width.
- Real-Obsidian e2e (`e2e/`, `npm run test:e2e:obsidian`): on the indexed corpus, a query
  renders a graph whose node count equals the number of graphable results, and ArrowDown
  moves the highlighted node to the 2nd result.
- `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e:obsidian` pass.

## Context
- Modal: `src/search-modal.ts` — `resultsEl` (`.seeker-results`), selection in
  `selectedIndex` painted by `applySelection()`, ↑/↓ in `moveSelection()`, results from
  `this.orchestrator.search(query, MAX_RESULTS)` (`MAX_RESULTS = 50`), infinite-scroll
  window over `currentResults` (graph covers all fetched results, not just shown rows).
- Layout CSS: `styles.css` (`.seeker-modal.modal`, `.seeker-modal .modal-content` flex
  column, `.seeker-results`). No side panel exists today.
- Settings shape/migration: `src/types.ts` (`SeekerSettings`, `DEFAULT_SETTINGS`,
  `migrateSettings`); UI in `src/settings-tab.ts`. Use the `obsidian-settings` skill.
- Visual/interaction reference (worked for the human on their vault):
  `git show spike/cluster-graph:spikes/cluster-graph/viewer.html`.
- Existing Obsidian e2e: `e2e/search.e2e.ts`, harness `e2e/obsidianHarness.ts`,
  docs `docs/e2e-obsidian.md`.

## Constraints
- Popout-window convention: `window.setTimeout` / `activeWindow`, never bare globals.
- Render SVG with Obsidian/DOM APIs; no runtime CDN loads (the plugin works offline).
- The modal is keyboard-first: the graph never takes focus from the query field.
- Leave room in the panel's top corner for the tuning-controls icon added by 3/3
  (`nid_9hlo527pksi0x5692ysfk80k8_e`); don't build the controls here.

## Non-goals
- Mobile / narrow-window graph, animation, zoom/pan, drag.
- Tuning controls (3/3), cluster labels, legend beyond what's needed to read colours.
