---
session_ids: [{"a": "claude", "type": "execution", "id": "14646f56-2a49-4904-a882-f684af56bb38"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_xhddcxd2lgqvnx7du6wxgtuq9_e
title: "Canvas 3/3: search-modal .canvas open branch + best-effort zoom-to-node with solid fallback"
status: in_progress
deps: [nid_13s1ij8gtxmxfy9my7p9ujy98_e, nid_uc1ko4l0thzf7slennqeac9xb_e]
links: []
created_iso: 2026-09-03T17:16:23Z
status_updated_iso: 2026-09-03T18:15:31Z
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


## Notes

**2026-09-03T17:43:51Z**

Post-rebase review addenda (docs/canvas-search-plan.md §6, 2026-09-03):
- R1 (needs human, Q7 in .out/current_decision.md): the chunk does NOT carry a node id and click-time chunk_id re-derivation is unsound (token-budget re-split). Option A: read `r.canvas_node_id` (set in part 1). Option B: open-only in v1, zoom-to-node becomes a follow-up ticket. Step 2 of this ticket is blocked on that call; steps 1 and 3 are unchanged.
- R6: fallback open is `leaf.openFile(file, { active })` (public API; .canvas is core-registered), not setViewState. Feature-detect `leaf.view.canvas` afterwards; at most one requestAnimationFrame retry if nodes are not ready, no polling.
- R5: insert-link for a .canvas result: subpath must be EMPTY (no `#Group`), and the no-active-file fallback keeps the `.canvas` extension (Obsidian requires [[x.canvas]]). Test both.

**2026-09-03T17:52:52Z**

DECIDED Q7 (2026-09-03): option A. Step 2 reads `r.canvas_node_id`; absent → open only. Node not found in the open canvas → open only. Never land on a wrong node. Also try `openFile(file, { eState: { match: { nodeId } } })` first as a five-minute empirical check (core search may already honour it, per Advanced Canvas canvas-patcher.ts comment); if it does not, fall through to feature-detected selectOnly + zoomToSelection. Tags decide/need-human cleared.
