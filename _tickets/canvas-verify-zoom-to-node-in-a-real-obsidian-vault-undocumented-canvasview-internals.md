---
id: nid_etn8wcmnxdhq12x7be6q6z2jt_e
title: "Canvas: verify zoom-to-node in a real Obsidian vault (undocumented CanvasView internals)"
status: closed
deps: []
links: [nid_xhddcxd2lgqvnx7du6wxgtuq9_e]
created_iso: 2026-09-03T18:20:59Z
status_updated_iso: 2026-09-03T18:20:59Z
type: chore
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_5w0bsx5qhm7xfssdkim4qshxv_e
tags: [canvas, need-human]
---

Review of ticket nid_xhddcxd2lgqvnx7du6wxgtuq9_e (branch commit 7a742a2) found no code defects, but the feature could not be exercised against a real Obsidian: the sandbox has no Obsidian, and src/canvas-open.ts relies on UNDOCUMENTED CanvasView internals (`leaf.view.canvas.nodes.get(id)`, `canvas.selectOnly(node)`, `canvas.zoomToSelection()`), feature-detected with a guaranteed open-only fallback.

Manual check (human, current Obsidian desktop):
1. Index a vault with a .canvas board containing one LONG text card (long enough to become its own chunk; see src/chunker.ts chunkCanvas / canvas_node_id) and some short cards.
2. Search for text from the long card, open the result (Enter, and Cmd/Ctrl+Enter for the background alt-open). Expected: the canvas opens AND that card is selected + zoomed. Also open a short-card / map result: the canvas just opens.
3. Open Seeker diagnostics (src/logger.ts report). If a `canvas-zoom-to-node` / `canvas-node-lookup` error line appears, or the card is never focused (outcome `no-api` / `node-missing` on every open), the internals' names changed: update `detectCanvasInternals` in src/canvas-open.ts and its tests in src/canvas-open.test.ts.
4. Optional: note whether `openFile(file, { eState: { match: { nodeId } } })` alone already focuses the node (speculative hint passed in src/canvas-open.ts open()). If it does, the explicit selectOnly/zoomToSelection could be dropped in a follow-up.

Outcome to record on this ticket: which Obsidian version was tested and whether zoom-to-node worked.

--------------------------------------------------------------------------------
HUMAN: verified worked.