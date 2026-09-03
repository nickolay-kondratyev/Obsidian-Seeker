---
id: nid_xhddcxd2lgqvnx7du6wxgtuq9_e
title: "Canvas 3/3: search-modal .canvas open branch + best-effort zoom-to-node with solid fallback"
status: open
deps: [nid_13s1ij8gtxmxfy9my7p9ujy98_e, nid_uc1ko4l0thzf7slennqeac9xb_e]
links: []
created_iso: 2026-09-03T17:16:23Z
status_updated_iso: 2026-09-03T17:16:23Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
parent: nid_5w0bsx5qhm7xfssdkim4qshxv_e
tags: [canvas]
---

Part 3 of 3 of the canvas search epic. Plan of record: docs/canvas-search-plan.md (§3b). Depends on parts 1 and 2.

Deliver in src/search-modal.ts, mirroring the existing `.base` branch (~line 1297):
1. ALWAYS open the canvas first via leaf state `type: 'canvas'`, respecting the modal's newTab / altOpenTarget semantics (background alt-open keeps the modal focused; plain open dismisses). This alone is the guaranteed fallback.
2. Only for a long-card chunk (non-empty nodeId): read the canvas, call `findCanvasNodeForChunk(raw, path, r.chunk_id)`; null → stop (canvas edited since indexing).
3. Feature-detect the undocumented internals (`view.canvas?.nodes?.get`, `typeof canvas.selectOnly === 'function'`, `zoomToSelection`) and call them inside try/catch; on failure log ONE diagnostics line and leave the user on the opened canvas. Never throw past the click handler.
- Skip buildMatchHighlight/scrollLeafToChunk for `.canvas` (they assume a text editor), as the base branch does.
- Tests with the obsidian stub: canvas missing → opened; selectOnly throws → opened; node found → selectOnly + zoomToSelection called with the right node; map chunk → open only.

