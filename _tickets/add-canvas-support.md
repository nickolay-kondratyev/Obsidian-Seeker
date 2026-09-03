---
closed_iso: 2026-09-03T16:54:38Z
id: nid_q2cjfljs5iios4c6gzb3unol2_e
title: add canvas support
status: closed
deps: []
links: []
created_iso: '2026-09-03T16:47:55Z'
status_updated_iso: 2026-09-03T16:54:38Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1
---

We would like to add canvas support for searching. 

First research how we could do it, I am thinking that we would want to mainly focus on nodes that have text of their own right, meaning if something is embedded we would NOT expand that content for search. But notes with their own content would get actual parsing and embedding. 

Right now we want to plan and research, you if you need judgement calls ask questions.

## Resolution (2026-09-03)

Research + plan delivered in `docs/canvas-search-plan.md`. Key findings:
- `.canvas` is JSON (`node_modules/obsidian/canvas.d.ts`): text / file / link /
  group nodes + labelled edges; group membership is geometric only.
- The `.base` support (`src/base-extractor.ts`, `chunkBase`, `chunksFor`,
  `isIndexableFile`, `indexBases`, the `.base` branch in `src/search-modal.ts`)
  is a one-to-one template; canvas mirrors every touchpoint.
- Scope agreed with the ticket: text nodes get full markdown chunking +
  embedding; file nodes are indexed as `[[basename#subpath]]` link text only,
  never expanded (duplicate-vector + per-file-mtime staleness reasons, plan §2).
- Short cards fold into one canvas-level "map" chunk with group/edge labels,
  link URLs and file refs; long cards become their own chunk(s) titled
  `<canvas> > <group> > <node label>`.
- No persisted-shape change, so no CHUNKER_VERSION / DB_VERSION bump.
- Node navigation on click: no public API; plan is best-effort undocumented
  `canvas.selectOnly/zoomToSelection` with node id re-derived at click time.

Judgement calls (6) are in `.out/current_decision.md` and mirrored in the
implementation ticket `_tickets/canvas-support.md` (nid_5w0bsx5qhm7xfssdkim4qshxv_e,
tagged decide + need-human, depends on this ticket).
