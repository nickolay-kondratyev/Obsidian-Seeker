---
id: nid_w09n6fd3gr8sk5loaes8qupqf_e
title: "Plan: desktop result-cluster graph beside the search list"
status: open
deps: [nid_hbu44aygn72ow3jap8bug52oe_e, nid_7uixcj2srfixonpvnyqoabtxk_e, nid_9hlo527pksi0x5692ysfk80k8_e]
links: []
created_iso: 2026-10-26T22:56:28Z
status_updated_iso: 2026-10-26T22:56:28Z
type: epic
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ui, cluster-graph, plan]
---

## Goal
On desktop, show a graph to the RIGHT of the search modal's result list that clusters
the current results by embedding similarity. A single ranked list can show either
relevance to the query or which results belong together, never both; the graph shows
both at once: distance from a central query node = relevance, proximity between notes
= mutual similarity, colour = cluster. The human evaluated a spike on their real vault
(2026-10-26) and approved building it.

## Done criteria
- All child tickets closed:
  - `nid_hbu44aygn72ow3jap8bug52oe_e` — Cluster graph 1/3: result-cluster model.
  - `nid_7uixcj2srfixonpvnyqoabtxk_e` — Cluster graph 2/3: desktop panel in the modal.
  - `nid_9hlo527pksi0x5692ysfk80k8_e` — Cluster graph 3/3: in-graph tuning controls.
- `src/CLAUDE.md` §Layers (UI) mentions the new modules in one line each.

## Context — what the spike established
Spike lives on LOCAL branch `spike/cluster-graph` (commit `dee9863`, worktree
`.worktree/spike-cluster-graph`, never merged, not pushed). Working reference
implementation of every algorithm below: `spikes/cluster-graph/viewer.html` on that
branch (`git show spike/cluster-graph:spikes/cluster-graph/viewer.html`). Data
extraction reference: `src/spike-cluster-graph.ts` on that branch.

Data — already there, nothing new to compute or store:
- Each result is one note (search dedupes per note; `src/search.ts` `search()`), carrying
  its best chunk's `chunk_id`. That chunk's stored vector stands in for the note.
- `IndexStore.getEmbeddingsByIds(ids)` (`src/index-store.ts`) returns dequantized fp32
  vectors aligned to input order (`null` for missing). `SearchOrchestrator` keeps the
  store private and exposes no vector accessor today; `ScoredChunk` carries no vector.
- The modal already awaits the model before searching (`src/search-modal.ts` runSearch,
  `modelReadyPromise`); reading vectors needs no model. (The spike's standalone command
  hit "Model not loaded" because it searched outside the modal — not an issue in-modal.)

Measured (frozen 150-note corpus, dev container, CPU, n = 50 = the modal's `MAX_RESULTS`):
| Step | Time |
|---|---|
| Vector fetch for 50 ids from IndexedDB | ~1.5 ms warm, ~19 ms first |
| Cosine matrix, 1,225 pairs × 384 dims | ~0.25 ms |
| Average-linkage clustering | ~0.2 ms |
| d3-force layout, 300 ticks | ~17–21 ms |
| The search itself, for comparison | ~50–60 ms |
Speed is a non-issue; layout is ~all of it and must not delay the list.

Design that worked in the spike (human saw it on their vault):
- **Relative, per-query thresholds.** Pairwise cosines sit in a narrow band
  (~0.62–0.94 on every query). A fixed cosine cut links all or nothing. Clusters =
  average-linkage cut at a percentile of THIS query's pairwise cosines (spike default
  p85); edges = each result's k most similar other results (spike default k = 2).
- **Radius by rank, not score.** Score min-max squashes: e.g. #1 = 0.875, #2–#50 all in
  0.75–0.78 → 49 nodes on the outer ring. Rank mirrors the list order the user sees.
- **Query node fixed at centre** with `forceRadial` per node, `forceLink` for kNN
  edges (stronger for more similar pairs), light `forceCollide` + `forceManyBody`.
- **Seed node positions on their target ring** (golden-angle spread). d3's default
  seed is a spiral around (0,0) → every node parks in the sector facing the SVG's
  top-left corner.
- **Linked selection** list ↔ graph (↑/↓ or hover on a row highlights its node and
  edges; hover on a node selects its row) is what makes the graph navigation, not
  decoration.
- A 2D layout cannot honour both distances exactly; it is a visual compromise for
  spotting groups, not for reading exact distances.

Decisions (settled with the human in chat, 2026-10-26):
- Desktop only, beside the list (right side), never below it; hidden on mobile.
- Cluster ourselves (no clustering library); d3 only for the force layout (`d3-force`,
  bundled — no runtime CDN, the plugin works offline).
- Title-only notes (`Chunk.lexicalOnly`) stay VISIBLE as grey nodes at their rank
  radius, but get no cluster and no edges (their title-only vector is close to
  everything and would merge unrelated clusters).
- Settings tab gets a desktop-only "Show result map" toggle, default ON.
- Tuning knobs (cut, k, radius mode, force balance) live in the graph panel behind a
  collapsed icon, persisted in settings (3/3).

## Non-goals (whole epic)
- Mobile / narrow-window graph.
- Grouping the list itself under cluster headers (rejected: one order can't show both
  relevance and similarity).
- Cluster labels / topic naming.
- Switching between different layout algorithms (deferred; see 3/3 Non-goals).
- Multi-chunk note vectors (mean of chunks) — best chunk is the stand-in.
