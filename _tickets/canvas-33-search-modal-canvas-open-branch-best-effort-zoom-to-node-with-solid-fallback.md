---
closed_iso: 2026-09-03T18:19:33Z
session_ids: [{"a": "claude", "type": "execution", "id": "14646f56-2a49-4904-a882-f684af56bb38"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_xhddcxd2lgqvnx7du6wxgtuq9_e
title: "Canvas 3/3: search-modal .canvas open branch + best-effort zoom-to-node with solid fallback"
status: closed
deps: [nid_13s1ij8gtxmxfy9my7p9ujy98_e, nid_uc1ko4l0thzf7slennqeac9xb_e]
links: []
created_iso: 2026-09-03T17:16:23Z
status_updated_iso: 2026-09-03T18:19:33Z
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

**2026-09-03T18:25:00Z — RESOLVED**

Built (commit 7a742a2):
- `src/canvas-open.ts` — `CanvasResultOpener.open(leaf, file, nodeId, active)`: always `leaf.openFile(file, { active, eState })` (R6, public API); then only when `nodeId` is set, feature-detects `leaf.view.canvas` (`nodes.get`, `selectOnly`, `zoomToSelection` all functions), one `requestAnimationFrame` retry if the node map is not ready, `selectOnly` + `zoomToSelection` inside try/catch. Returns an outcome (`opened | focused | node-missing | no-api | focus-failed`); a throwing internal reports ONE line via `logger.appendError` and leaves the user on the opened canvas. Deps (`reportFailure`, `nextFrame`) are injected so the branch is unit-testable and follows the popout-window convention (`activeWindow.requestAnimationFrame`).
- `src/search-modal.ts` `openResult`: `.canvas` branch after the `.base` one; leaf selection + modal focus/close semantics mirror the markdown path (alt-open background leaf keeps the modal focused; plain open closes). No highlight/scroll for canvas. Node id = `r.canvas_node_id` (Q7 option A); absent → open only.
- `src/canvas-open.test.ts` — map chunk → open only; node found → selectOnly+zoomToSelection with the exact node; internals missing / partial → opened, no diagnostics; node deleted → one rAF retry then silent; nodes ready on the retry → focused; selectOnly throws / nodes.get throws → opened + exactly one diagnostics line.
- R5 insert-link: `isInsertableMarkdownFile` → `isInsertableFile` (md + canvas; `.base` still excluded because its `#View` link shape was never decided). `resolveInsertLinkSubpath(file, headingPath, titleNav)` now takes the file and returns '' for any non-md, so a canvas result links as `[[Roadmap.canvas]]` — the no-active-file fallback already kept the extension. Tests for both in `insert-link.test.ts`. The `seeker:insert-link` CLI in `main.ts` uses the same gate.
- Docs: `src/CLAUDE.md` UI layer lists `canvas-open.ts`; README feature bullet mentions the zoom-to-card behaviour.

Assumptions / not verified here:
- The five-minute empirical check of `openFile(file, { eState: { match: { nodeId } } })` could NOT be run (no Obsidian in this sandbox). The hint is passed regardless; if core honours it the explicit focus re-selects the same node, if not it is ignored. Verify in a real vault: open a long-card result and confirm the card is selected + zoomed. If `no-api` shows up in diagnostics on a current Obsidian, the internals' names changed — update `detectCanvasInternals` in `canvas-open.ts`.
- Widening insert-link to `.canvas` was read as implied by the R5 note ("test both"); `.base` left as-is.
