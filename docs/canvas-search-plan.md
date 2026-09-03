# Canvas search — research & plan

Status: PLAN (research ticket `nid_q2cjfljs5iios4c6gzb3unol2_e`, 2026-09-03).
Implementation ticket: `_tickets/canvas-support.md` (`nid_5w0bsx5qhm7xfssdkim4qshxv_e`).
Open judgement calls are listed at the bottom; they are mirrored in that ticket.

## 1. What a `.canvas` file is

JSON (`node_modules/obsidian/canvas.d.ts`, `CanvasData`): `{ nodes: [], edges: [] }`.
Four node types, all with `id, x, y, width, height, color?`:

| type    | own text?                     | fields                         |
|---------|-------------------------------|--------------------------------|
| `text`  | YES — markdown body           | `text`                         |
| `file`  | NO — points at a vault file   | `file`, `subpath?` (`#Heading` / `#^block`) |
| `link`  | NO — external URL             | `url`                          |
| `group` | label only                    | `label?`, `background?`        |

Edges: `fromNode, toNode, label?`. There is NO parent/child relation in the file;
group membership is purely geometric (a node's rect lies inside the group's rect).

Obsidian rewrites the file on every drag/resize, so the mtime advances without
any text change. The delta path already handles that cheaply: `classifyFileDelta`
→ dirty → re-chunk → unchanged `chunk_id`s → no re-embed (chunk-diff invariant).

## 2. Scope (per ticket): index only text that lives IN the canvas

- `text` nodes: full markdown parsing + embedding — they are notes in their own right.
- `group` labels, `edge` labels, `link` URLs, and `file`-node references: indexed
  as **short descriptive text** only (the "map" of the canvas).
- `file` nodes are NOT expanded to the referenced note's content. Two reasons
  beyond the ticket's instinct:
  1. The referenced note is already indexed under its own path; expanding it
     produces a duplicate vector under a second path — a double hit for every
     query, and `note_path`-level dedup/ranking would have to learn about it.
  2. Delta indexing is per-file-mtime. Expanded content would go stale when the
     referenced note changes, because nothing bumps the canvas's mtime. Keeping
     canvas chunks a pure function of the canvas bytes preserves the
     "chunk ids re-derivable from the file alone" invariant that the sidecar
     hydrate path (`reChunkLive` / `collectLiveIds`) depends on.

## 3. Model: canvas-as-document, text nodes as sections

Mirror the Bases precedent exactly (`src/base-extractor.ts` + `chunkBase`): one
extractor module turns the file into synthetic docs; the chunker turns docs into
`Chunk`s that ride the whole existing pipeline (token budget, dense-clean, BM25,
dedup, sidecar, nav).

### 3a. Chunks produced per canvas

1. **Canvas-level chunk** — title `<canvas basename>`, empty `heading_path`.
   Content = the canvas "map", newline-joined and deduped:
   - every group label
   - every file-node reference rendered as a wikilink `[[basename#subpath]]`
     (so `cleanDenseText` flattens it and `extractLinkTerms` reclaims the
     target for BM25 — identical treatment to a wikilink inside a note)
   - every link-node URL (bare URL → dense-clean's existing scheme/TLD strip +
     `link_terms` reclamation)
   - every edge label
   - every SHORT text node (below the chunker's `minChunkChars`, currently 50)
     verbatim. Rationale: canvases are full of "Buy milk"-sized cards; one tiny
     vector per card is exactly the universal-near-neighbour hazard that the
     `lexicalOnly` comment in `src/types.ts` documents. Folding them into the map
     keeps them searchable (BM25 + one dense vector) without the noise.
   Wins bare-name queries via the title boost, like the base-level entry.
2. **One (or more) chunks per LONG text node** — run the node's markdown through
   `MarkdownChunker.chunkContent(text, canvasPath, noteTitle)` with
   `noteTitle = "<canvas> > <group label> > <node label>"`, where:
   - `group label` = label of the smallest group whose rect contains the node's
     rect (omitted when none). This is the canvas's only hierarchy and it is
     what a user says when they search ("the Q3 goals section"); it earns the
     3.0x headings field the same way a base's view name does.
   - `node label` = the node's first heading if the text starts with one, else
     its first non-empty line truncated to ~60 chars.
   `chunkContent` gives us heading splitting, frontmatter (rare but legal in a
   card), inline tags, dense-clean, and the 512-token budget for free.
   `start_line/end_line` are meaningless for a node → set to 1/1 like bases;
   the modal skips the editor highlight path for `.canvas` exactly as it does
   for `.base`.

`chunk_id` stays `chunkIdFor(canvasPath, title, content)`; two identical cards
in one canvas collapse to one row (same accepted semantics as identical sections
within a note). No new persisted fields → **no `CHUNKER_VERSION` / `DB_VERSION`
bump**; existing indexes pick canvases up on the next startup delta because
`classifyFileDelta(undefined)` → `dirty`.

### 3b. Click → open the node (navigation)

Public API can only open the canvas file. Focusing a node is undocumented
(`view.canvas.nodes.get(id)`, `canvas.selectOnly(node)`, `canvas.zoomToSelection()`),
but every canvas plugin in the ecosystem relies on it (Advanced Canvas, Enhanced
Canvas — see forum thread "Canvas interaction functions").

Plan: open the leaf with `type: 'canvas'` state (mirroring the `.base` branch in
`search-modal.ts`), then **best-effort** focus in a `try/catch` that degrades to
"canvas opened, not zoomed". No node id is persisted: at click time the modal
re-reads the canvas, re-runs the extractor, and finds the doc whose re-derived
`chunk_id` equals the hit's — the same re-derivation principle the sidecar uses,
so it costs one JSON parse per click and zero schema change.

### 3c. Touchpoints (the `.base` checklist, verbatim)

| Where | Change |
|-------|--------|
| `src/canvas-extractor.ts` (new) | `extractCanvasDocs(raw, path): CanvasDoc[]` + `findCanvasNodeForChunk(raw, path, chunkId)` for nav. Pure, Obsidian-free (JSON only). |
| `src/types.ts` | `CanvasDoc { nodeId: string \| null; title: string; text: string }` (null = canvas-level). |
| `src/chunker.ts` | `chunkCanvas(docs, path, modified)` — canvas-level entry like `chunkBase`; text-node docs through `chunkContent`. |
| `src/search.ts` `indexableFiles` / `chunksFor` | add `canvas` gated on `settings.indexCanvases`. |
| `src/main.ts` `isIndexableFile` | same gate (watcher). |
| `src/types.ts` settings + `settings-tab.ts` | `indexCanvases: boolean` (default ON, like `indexBases`); reindex total count. |
| `src/search-modal.ts` | `.canvas` open branch + best-effort node focus. |
| `src/test-stubs/obsidian.ts` | extend the `extension` stub note for `canvas`. |
| `src/redact.ts` | already lists `canvas` in `VAULT_EXT` — no change. |
| `README.md` | one line under indexed file types. |

Estimated size: ~350 LOC source + tests. Bench not affected.

### 3d. Tests (write first)

- `canvas-extractor.test.ts`: fixture canvas with all four node types + edges;
  malformed JSON / empty / missing `nodes` degrade to the canvas-level entry;
  nested groups pick the innermost; node partially outside a group is NOT a
  member; short-node folding threshold; file node with `subpath`; link node;
  `findCanvasNodeForChunk` round-trips every emitted chunk id.
- `chunker.test.ts`: `chunkCanvas` ids stable across re-derivation; heading
  split inside a long card; frontmatter in a card.
- `search.ts` route test (`chunksFor` picks `chunkCanvas`), `main.ts`
  `isIndexableFile` gate, settings-migrate default, modal open-branch with the
  stub (focus failure swallowed).

## 4. Explicitly out of scope (follow-up tickets if wanted)

- Expanding `file`-node content (rejected, §2).
- Edge-aware context ("→ label → neighbour card") appended to node chunks.
- Canvas `.canvas` files inside `.base` views / embeds of canvases in notes.
- Group `background` images (image-ocr ticket territory).

## 5. Judgement calls for the human

See `.out/current_decision.md` (same list as the implementation ticket).
Recommendations are marked; silence = go with the recommendation.

Sources: [Canvas spec (obsidian-api canvas.d.ts)](https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts),
[Canvas interaction functions — Obsidian forum](https://forum.obsidian.md/t/canvas-interaction-functions/51959),
[Feature request: link to a canvas card](https://forum.obsidian.md/t/canvas-ability-to-link-to-a-specific-group-a-selected-section-a-card-of-a-canvas/49779),
[Advanced Canvas plugin](https://community.obsidian.md/plugins/advanced-canvas),
[Enhanced Canvas plugin](https://community.obsidian.md/plugins/enhanced-canvas).
