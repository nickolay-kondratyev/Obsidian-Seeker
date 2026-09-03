---
id: nid_13s1ij8gtxmxfy9my7p9ujy98_e
title: "Canvas 1/3: canvas-extractor.ts + chunker headingPrefix + chunkCanvas (pure, tests first)"
status: open
deps: [nid_q2cjfljs5iios4c6gzb3unol2_e]
links: []
created_iso: 2026-09-03T17:16:23Z
status_updated_iso: 2026-09-03T17:16:23Z
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

