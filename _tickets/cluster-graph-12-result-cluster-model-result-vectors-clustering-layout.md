---
id: nid_hbu44aygn72ow3jap8bug52oe_e
title: "Cluster graph 1/2: result-cluster model (result vectors, clustering, layout)"
status: open
deps: []
links: []
created_iso: 2026-10-26T22:56:28Z
status_updated_iso: 2026-10-26T22:56:28Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_w09n6fd3gr8sk5loaes8qupqf_e
tags: [ui, cluster-graph]
---

## Goal
Everything the result-cluster graph needs EXCEPT drawing it: read the search results'
stored vectors, and turn (ranked results + vectors) into a deterministic graph model
(node positions, cluster ids, edges). Pure and unit-tested, so the UI ticket
(`nid_7uixcj2srfixonpvnyqoabtxk_e`) only renders. Read the plan first:
`_tickets/plan-desktop-result-cluster-graph-beside-the-search-list.md` (spike learnings,
measured timings, why each design choice).

## Done criteria
- `SearchOrchestrator` (`src/search.ts`) exposes a public way to get the vectors for a
  list of results, aligned to the input order, `null` where a vector is missing. Unit
  test covers alignment and the missing case.
- A new Obsidian-free module (no `obsidian` import) builds the graph model from ranked
  results + vectors. Unit tests (BDD style, `src/<module>.test.ts`) prove:
  - two clearly separated groups of hand-built vectors land in two different clusters;
  - same input → identical output (positions included), run twice;
  - edges: no self-edges, no duplicate pairs, at most k per node as source;
  - the rank-1 node ends closer to the query centre than the last-ranked node;
  - lexical-only results (`Chunk.lexicalOnly`) get no cluster and no edges;
  - results with a `null` vector are left out of the model; fewer than 2 usable vectors
    → an empty model, no throw;
  - works for any vector dimension (test with a non-384 dim).
- `d3-force` added as a dependency (no other d3 packages unless needed for layout).
- `npm run typecheck`, `npm run test` (includes `scripts/build-reproducible.test.mjs`)
  and `npm run build` pass.

## Context
- Vectors: `IndexStore.getEmbeddingsByIds` (`src/index-store.ts`); the orchestrator
  holds the store privately (`src/search.ts`, `private store: IndexStore`). Results are
  `ScoredChunk[]` (`src/types.ts`), one per note, with `chunk_id`, `score`,
  `lexicalOnly?`.
- Reference implementation of cosine matrix, average-linkage, kNN edges and the
  seeded radial force layout: `git show spike/cluster-graph:spikes/cluster-graph/viewer.html`
  (functions `cosineMatrix`, `averageLinkage`, `knnEdges`, `renderGraph`).
- Precedent for a pure, Obsidian-free module with colocated tests: `src/passage.ts`,
  `src/model-draft.ts`.

## Constraints
- Thresholds are RELATIVE per query: cluster cut = percentile of this query's pairwise
  cosines (default p85), edges = each node's k most similar others (default k = 2).
  Named constants, not tunable UI. WHY: cosines sit in a narrow ~0.62–0.94 band.
- Radius from RANK, not score (WHY in plan). Query node fixed at the centre.
- Seed each node on its target ring (golden-angle spread); never rely on d3's default
  (0,0) spiral seed — it skews the whole layout into one sector.
- Run the simulation to completion synchronously (fixed tick count), no animation
  timers — determinism + testability.
- Lexical-only results excluded from clustering/edges. WHY: their vector is just the
  title (often a bare date) — a near-universal neighbour (see `Chunk.lexicalOnly` doc in
  `src/types.ts`) that would glue unrelated clusters together.
- Normalize vectors before dot products (dequantized int8 is not exactly unit length).
- Layout takes width/height (or a radius) as input; no DOM access.
- Average-linkage naive O(n³) is fine at n = 50; mark the ceiling in a comment.

## Non-goals
- Rendering, modal changes, CSS, settings (all in `nid_7uixcj2srfixonpvnyqoabtxk_e`).
- Tunable cut/k, score-based radius, cluster naming.
