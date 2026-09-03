---
id: nid_5w0bsx5qhm7xfssdkim4qshxv_e
title: "Canvas support"
status: open
deps: [nid_q2cjfljs5iios4c6gzb3unol2_e, nid_13s1ij8gtxmxfy9my7p9ujy98_e, nid_uc1ko4l0thzf7slennqeac9xb_e, nid_xhddcxd2lgqvnx7du6wxgtuq9_e]
links: []
created_iso: 2026-09-02T23:21:49Z
status_updated_iso: 2026-09-03T16:54:37Z
type: epic
priority: 3
assignee: nickolaykondratyev
tags: []
---

Implement canvas (`.canvas`) search per the PLAN OF RECORD in
`docs/canvas-search-plan.md` (research ticket nid_q2cjfljs5iios4c6gzb3unol2_e;
all six judgement calls decided by the human on 2026-09-03, plan §5).

Summary:
- Mirror the Bases precedent (`src/base-extractor.ts` + `chunkBase`): new pure
  `src/canvas-extractor.ts` → `chunkCanvas` in `src/chunker.ts`; route in
  `src/search.ts` `chunksFor`/`indexableFiles`; watcher gate in `src/main.ts`
  `isIndexableFile`; setting `indexCanvases` (default ON); `.canvas` open branch
  in `src/search-modal.ts`.
- Long text nodes: real markdown chunking + embedding, title/heading_path seeded
  with the FULL outer→inner group chain (nested groups supported, geometric
  containment). NO invented node label: heading-less cards keep an empty or
  group-only heading_path. `chunkContent` gains an optional `headingPrefix`
  (default `[]`, markdown ids unchanged).
- Map: short cards, group/edge labels, link URLs and file refs as
  `[[basename#subpath]]` assembled into a synthetic markdown doc (one heading
  per group chain) and chunked normally, so large canvases split into sub-maps.
- File-node content NEVER expanded (not even `#^block`).
- Click: open canvas always; best-effort zoom-to-node via feature-detected
  internals in try/catch; node found by re-deriving chunk ids at click time.
- No persisted-shape change → no CHUNKER_VERSION / DB_VERSION bump.
- Tests first: plan §3d. Bench unaffected.
