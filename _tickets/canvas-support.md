---
id: nid_5w0bsx5qhm7xfssdkim4qshxv_e
title: "Canvas support"
status: open
deps: [nid_q2cjfljs5iios4c6gzb3unol2_e]
links: []
created_iso: 2026-09-02T23:21:49Z
status_updated_iso: 2026-09-03T16:54:37Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [decide, need-human]
---

Implement canvas (`.canvas`) search per the plan in `docs/canvas-search-plan.md`
(research done under ticket nid_q2cjfljs5iios4c6gzb3unol2_e, 2026-09-03).

Summary of the plan:
- Mirror the Bases precedent (`src/base-extractor.ts` + `chunkBase`): new pure
  `src/canvas-extractor.ts` → `chunkCanvas` in `src/chunker.ts`; route in
  `src/search.ts` `chunksFor`/`indexableFiles`; watcher gate in `src/main.ts`
  `isIndexableFile`; setting `indexCanvases` (default ON); `.canvas` open branch
  in `src/search-modal.ts`.
- Index only text that lives IN the canvas: text nodes get real markdown chunking
  + embedding; group/edge labels, link URLs and file-node references (as
  `[[basename#subpath]]`) go into one canvas-level "map" chunk. File-node content
  is NEVER expanded (see plan §2 for why).
- No persisted-shape change → no CHUNKER_VERSION / DB_VERSION bump.
- Tests first: see plan §3d.

BLOCKED on human answers to the judgement calls in `.out/current_decision.md`
(Q1 granularity, Q2 group hierarchy, Q3 click/zoom-to-node, Q4 file nodes,
Q5 setting default, Q6 node label). Each has a recommended option; the plan
is written against the recommendations.
