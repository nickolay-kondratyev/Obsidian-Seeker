---
closed_iso: 2026-09-03T18:06:29Z
session_ids: [{"a": "claude", "type": "execution", "id": "69b3bb09-5001-4c5d-85c4-ab3cbbf2c34f"}, {"a": "claude", "type": "review", "id": "7d728a75-5cfd-4093-8125-d8850bccd087"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_13s1ij8gtxmxfy9my7p9ujy98_e
title: "Canvas 1/3: canvas-extractor.ts + chunker headingPrefix + chunkCanvas (pure, tests first)"
status: closed
deps: [nid_q2cjfljs5iios4c6gzb3unol2_e]
links: []
created_iso: 2026-09-03T17:16:23Z
status_updated_iso: 2026-09-03T18:06:29Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
parent: nid_5w0bsx5qhm7xfssdkim4qshxv_e
tags: [canvas]
---

Part 1 of 3 of the canvas search epic. Plan of record: docs/canvas-search-plan.md (read §3a, §3c, §3d first). Precedent to mirror: src/base-extractor.ts + chunkBase in src/chunker.ts.

Deliver (pure, Obsidian-free, no wiring yet):
- src/types.ts: `CanvasDoc { nodeId: string | null; groupChain: string[]; text: string }` (null nodeId = the map document).
- src/canvas-extractor.ts: `extractCanvasDocs(raw, path): CanvasDoc[]` — parse JSON (types from node_modules/obsidian/canvas.d.ts), geometric group containment with full outer→inner chain (nested groups, px tolerance, unlabelled groups transparent, overlapping siblings deterministic by area), map document assembled as synthetic markdown (one heading per group chain, level = depth; lines for short text nodes < minChunkChars, file nodes as `[[basename#subpath]]`, link URLs, edge labels under their fromNode chain; ungrouped items in preamble), one doc per LONG text node. Malformed/empty JSON degrades to a map doc holding the canvas name. Also `findCanvasNodeForChunk(raw, path, chunkId): string | null` (re-derive and match chunk_id; used by part 3).
- src/chunker.ts: `chunkContent` gains optional `headingPrefix: string[]` (default [] — markdown chunk ids MUST stay byte-identical; add a test proving it); `chunkCanvas(docs, path, modified)` maps each doc through chunkContent (map doc: noteTitle = canvas basename; long card: noteTitle = canvas basename, headingPrefix = groupChain). NO invented node label (decision Q6). start/end_line = 1/1.
- Tests: src/canvas-extractor.test.ts + chunker.test.ts cases listed in plan §3d, including a 300-card canvas producing multiple map parts each within the token budget.

No CHUNKER_VERSION bump needed (no persisted-shape change).


## Notes

**2026-09-03T17:43:51Z**

Post-rebase review addenda (docs/canvas-search-plan.md §6, 2026-09-03):
- R1: DROP findCanvasNodeForChunk (token-budget re-split makes click-time id re-derivation unsound). If the human picks option A, add optional `canvas_node_id?: string` to Chunk in src/types.ts, set by chunkCanvas on long-card chunks only, NOT hashed into chunk_id; test that token-budget split parts and the carry fold keep it.
- R2: map items are ONE line each (`- ` prefix, internal newlines collapsed), separated by a BLANK line; group-label headings collapsed to one line, empty label = unlabelled; heading level = min(depth, 6). Tests: a card starting with `# `, ``` and `---` does not corrupt the following sections; 7-deep chain caps at level 6.
- R3: short/long classification on cleanDenseBody(text).length >= minChunkChars (threshold passed in from the chunker); a card that cleans to empty goes to the map as its raw line.
- R4: headingPrefix must reach all three chunkContent emit sites (section emit, carry backward-fold, title-only fallback) — the fallback currently hard-codes heading_path []. One test per site.
- R7: per-node type guards (non-array nodes/edges, non-numeric geometry ⇒ ungrouped, non-string text/label/file/url ⇒ skipped); edge whose fromNode is a group ⇒ that group's own chain; unknown fromNode ⇒ preamble.

**2026-09-03T17:52:52Z**

DECIDED Q7 (2026-09-03): option A. Add optional `canvas_node_id?: string` to Chunk (src/types.ts), set by chunkCanvas on long-card chunks, never hashed into chunk_id. If two docs of the same canvas yield the same chunk_id (duplicate cards), clear the field on that row — ambiguity must open the canvas, not a wrong node. Tests: field present on a unique card, absent on map chunks, absent on duplicated cards, preserved through the token-budget split and the carry fold.

**2026-09-03T18:06:28Z**

RESOLVED (2026-09-03). Built, pure and Obsidian-free, no wiring yet (parts 2/3 wire search.ts / main.ts / modal):

- src/types.ts: `CanvasDoc { nodeId, groupChain, text }`; `Chunk.canvas_node_id?: string` (Q7 option A; never hashed into chunk_id).
- src/canvas-extractor.ts: `extractCanvasDocs(raw, path, minChunkChars)` — NOTE the 3rd arg: the caller passes `chunker.minChunkChars` (R3: short/long classified on `cleanDenseBody(text).length`). Returns the map doc FIRST (nodeId null), then one doc per long card in file order. Exports `GROUP_CONTAINMENT_TOLERANCE_PX` (1px). `findCanvasNodeForChunk` was NOT built (dropped per plan §6 R1).
  - Map doc layout (R2): items are `- ` lines, newlines collapsed, blank-line separated; group chains rendered as a trie (children sorted by label, items sorted by text — deliberately NOT node order, because Obsidian rewrites the nodes array on z-order changes and text order keeps map chunk ids stable). Heading level = min(depth, 6). Empty map → text = canvas basename.
  - Guards (R7): non-array nodes/edges → ignored; non-numeric geometry → ungrouped; non-string text/label/file/url → skipped; group's own chain includes itself for edge-from-group; unknown/missing fromNode → preamble. Never throws.
  - File node → `[[basename#subpath]]` (`.md` stripped, other extensions kept).
- src/chunker.ts: `chunkContent(..., headingPrefix: string[] = [])` reaches all emit sites (preamble/heading-less, section, carry flush, title-only fallback) via one `titleFor(headingPath)` helper; empty prefix is byte-identical (test + chunker-idpin.test.ts both green, no CHUNKER_VERSION bump). `chunkCanvas(docs, path, modified)`: noteTitle = canvas basename, headingPrefix = groupChain, start/end_line forced to 1/1, `canvas_node_id` set on long-card chunks then CLEARED on any chunk_id shared by >1 chunk of the canvas (duplicate cards).
- Tests: src/canvas-extractor.test.ts (34) and the two new describe blocks at the end of src/chunker.test.ts (17, incl. 300-card canvas through enforceTokenBudget with a fake counter: multiple parts, all ≤ TOKEN_BUDGET, overBudget 0; canvas_node_id preserved through split parts and carry fold; injection-safe map; 7-deep chain).
- src/CLAUDE.md §Chunking gained a one-line pointer.

Assumption stated: title chain is `<canvas> > <prefix…> [> headings…]` exactly as the plan; a grouped card in group "Roadmap" of canvas "Roadmap" is therefore titled "Roadmap > Roadmap" (no dedup — same rule as a note whose heading repeats its name).

**2026-09-03T18:08:37Z**

__READY_AS_IS__: review found no bugs; typecheck + 1322 tests green; headingPrefix reaches all emit sites, map injection-safe, canvas_node_id dedup/split/carry covered.
