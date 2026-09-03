---
id: nid_uc1ko4l0thzf7slennqeac9xb_e
title: "Canvas 2/3: wire .canvas into indexing (search.ts, main.ts watcher, indexCanvases setting, README)"
status: open
deps: [nid_13s1ij8gtxmxfy9my7p9ujy98_e]
links: []
created_iso: 2026-09-03T17:16:23Z
status_updated_iso: 2026-09-03T17:16:23Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
parent: nid_5w0bsx5qhm7xfssdkim4qshxv_e
tags: [canvas]
---

Part 2 of 3 of the canvas search epic. Plan of record: docs/canvas-search-plan.md (§3c touchpoints). Depends on part 1 (extractor + chunkCanvas).

Deliver, mirroring every `.base` / `indexBases` touchpoint:
- src/types.ts settings: `indexCanvases: boolean`, default true; settings-migrate test for the default.
- src/search.ts: `indexableFiles()` adds `extension === 'canvas'` gated on the setting; `chunksFor()` routes `.canvas` → extractCanvasDocs + chunkCanvas (the ONLY place the split lives — reChunkLive/collectLiveIds/dedupViaSidecar/carryOverHydrate all go through it).
- src/main.ts `isIndexableFile`: same gate (watcher create/modify/rename/delete).
- src/settings-tab.ts: toggle next to the Bases toggle + reindex total count includes canvases.
- src/test-stubs/obsidian.ts: extend the `extension` stub note for canvas.
- README.md: one line under indexed file types.
- Tests: chunksFor route, isIndexableFile gate, settings default. Verify the drag/resize case: rewriting a canvas with only x/y changes re-derives identical chunk ids → no re-embed (classifyFileDelta → dirty → chunk diff → nothing to embed).

