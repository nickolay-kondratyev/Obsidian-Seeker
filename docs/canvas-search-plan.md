# Canvas search — research & plan

Status: PLAN OF RECORD (research ticket `nid_q2cjfljs5iios4c6gzb3unol2_e`,
2026-09-03; the six judgement calls were decided by the human the same day, §5).
Implementation ticket: `_tickets/canvas-support.md` (`nid_5w0bsx5qhm7xfssdkim4qshxv_e`).

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

**Group chain first.** Canvas JSON has no parent links, so containment is
geometric: group B is inside group A when B's rect is fully inside A's (with a
small px tolerance so flush-snapped rects count). For any node, collect every
containing group, sort by area smallest-first, reverse → the chain
`["Roadmap", "Q3 Goals"]` outermost-to-innermost. Unlabelled groups still count
for containment but contribute no name. Overlapping siblings (neither contains
the other) are both kept, area order making it deterministic. Nesting depth is
unbounded. One helper produces the chain; both chunk kinds below use it.

1. **Map chunk(s)** — the canvas's own short text, built as a SYNTHETIC MARKDOWN
   DOCUMENT and pushed through `chunkContent`, so the existing heading split +
   512-token budget produce sub-maps for free (Q1: a canvas with hundreds of
   small cards must not become one oversized map). Layout:
   - each distinct group chain becomes a heading whose level = chain depth
     (`# Roadmap`, `## Q3 Goals`), so `heading_path` carries the chain;
   - under it, one line per item that lives in that chain: every SHORT text
     node (below the chunker's `minChunkChars`, currently 50) verbatim, every
     file node as `[[basename#subpath]]` (so `cleanDenseText` flattens it and
     `extractLinkTerms` reclaims the target for BM25 — identical treatment to a
     wikilink inside a note), every link node's URL (bare URL → dense-clean's
     scheme/TLD strip + `link_terms`), and every edge label whose `fromNode`
     lives there;
   - ungrouped items go in the preamble before the first heading (empty
     `heading_path`, like a note's preamble).
   Title = `<canvas basename>`; the preamble/first part wins bare-name queries
   via the title boost, like the base-level entry. Sub-min sections fold into
   neighbours exactly as in a note. Rationale for folding short cards: one tiny
   vector per "Buy milk" card is the universal-near-neighbour hazard the
   `lexicalOnly` comment in `src/types.ts` documents; folding keeps every card
   BM25-findable with far fewer vectors.
2. **One (or more) chunks per LONG text node** — run the node's markdown through
   `chunkContent(text, canvasPath, noteTitle, modified, headingPrefix)` with
   `noteTitle = "<canvas>"` and `headingPrefix = <group chain>`. The chunker
   seeds `heading_path` (and the ` > ` title chain) from the prefix, then
   appends any headings the card itself contains. A card without headings gets
   title `<canvas> > Roadmap > Q3 Goals` and `heading_path = ["Roadmap","Q3 Goals"]`;
   an ungrouped heading-less card gets the bare canvas title and an empty
   `heading_path`. **No synthetic node label is invented** (Q6): the first line
   is already in the content, and promoting it to the title would only give
   those words a fake 3.0x title boost. Empty `heading_path` is already a
   first-class state (note preambles, base-level entries). `chunkContent`'s
   new `headingPrefix` param defaults to `[]`, so markdown chunk ids are
   byte-identical to today.
   `chunkContent` also gives frontmatter (rare but legal in a card), inline
   tags, dense-clean and the token budget for free. `start_line/end_line` are
   meaningless for a node → 1/1 like bases; the modal skips the editor
   highlight path for `.canvas` exactly as it does for `.base`.

`chunk_id` stays `chunkIdFor(canvasPath, title, content)`; two identical cards
in one group collapse to one row (same accepted semantics as identical sections
within a note). No new persisted fields → **no `CHUNKER_VERSION` / `DB_VERSION`
bump**; existing indexes pick canvases up on the next startup delta because
`classifyFileDelta(undefined)` → `dirty`. A drag/resize rewrites the file but
re-derives identical ids → no re-embed; a one-card edit changes only that card's
chunk (or the one map part it lives in).

### 3b. Click → open the node (navigation)

Public API can only open the canvas file. Focusing a node is undocumented
(`view.canvas.nodes.get(id)`, `canvas.selectOnly(node)`, `canvas.zoomToSelection()`),
but every canvas plugin in the ecosystem relies on it (Advanced Canvas, Enhanced
Canvas — see forum thread "Canvas interaction functions").

Decided (Q3): best-effort zoom with a SOLID fallback. Order of operations:
1. Always open the canvas first via the leaf state (`type: 'canvas'`, mirroring
   the `.base` branch in `search-modal.ts`). This step alone is the fallback and
   must succeed independently of everything below.
2. Only for a text-node chunk (map chunks → open only): re-read the canvas,
   re-run the extractor, and pick the doc whose re-derived `chunk_id` equals the
   hit's — the sidecar's own re-derivation principle, one JSON parse per click,
   zero schema change. Not found (canvas edited since indexing) → stop, opened.
3. Feature-detect before touching internals (`typeof canvas?.selectOnly ===
   'function'` etc.), wrap in `try/catch`, and log a single diagnostics line on
   failure. Any exception leaves the user on the opened canvas.
A test drives the modal with a stub whose `canvas` is missing / throws and
asserts the open still happened and the modal state is correct.

### 3c. Touchpoints (the `.base` checklist, verbatim)

| Where | Change |
|-------|--------|
| `src/canvas-extractor.ts` (new) | `extractCanvasDocs(raw, path): CanvasDoc[]` (group-chain geometry, map document assembly, long-card docs) + `findCanvasNodeForChunk(raw, path, chunkId)` for nav. Pure, Obsidian-free (JSON only). |
| `src/types.ts` | `CanvasDoc { nodeId: string \| null; groupChain: string[]; text: string }` (null nodeId = map document). |
| `src/chunker.ts` | `chunkContent` gains an optional `headingPrefix: string[]` (default `[]`, ids unchanged); `chunkCanvas(docs, path, modified)` maps each doc through it. |
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
  malformed JSON / empty / missing `nodes` degrade to a map doc with the canvas
  name; nested groups (3 deep) yield the full outer→inner chain; a card
  partially outside a group is NOT a member; unlabelled group is transparent;
  overlapping sibling groups are deterministic; short/long card threshold; map
  document puts items under the right heading depth; file node with `subpath`;
  link node; edge label attributed to its `fromNode`'s chain;
  `findCanvasNodeForChunk` round-trips every emitted long-card chunk id.
- `chunker.test.ts`: `headingPrefix` seeds title + `heading_path` and leaves
  markdown ids unchanged when empty; `chunkCanvas` ids stable across
  re-derivation; heading split inside a long card; heading-less card has empty
  `heading_path` when ungrouped; a 300-card canvas yields multiple map parts
  each within the token budget.
- `search.ts` route test (`chunksFor` picks `chunkCanvas`), `main.ts`
  `isIndexableFile` gate, settings-migrate default, modal open-branch with the
  stub (focus missing / throwing → canvas still opened).

## 4. Explicitly out of scope (follow-up tickets if wanted)

- Expanding `file`-node content (rejected, §2).
- Edge-aware context ("→ label → neighbour card") appended to node chunks.
- Canvas `.canvas` files inside `.base` views / embeds of canvases in notes.
- Group `background` images (image-ocr ticket territory).

## 5. Decisions (human, 2026-09-03)

| Q | Decision |
|---|----------|
| Q1 granularity | Per-node chunks for long cards; short cards + labels/refs fold into the map. The map MUST split into sub-maps when large → built as a markdown doc and chunked normally (§3a). |
| Q2 groups | Full support incl. arbitrarily nested groups; full outer→inner chain in title and `heading_path`. |
| Q3 click | Best-effort zoom-to-node only if robust; open-whole-canvas is the guaranteed fallback (§3b). |
| Q4 file nodes | Link text only. No expansion, not even `#^block` refs (KISS). |
| Q5 setting | `indexCanvases`, default ON. |
| Q6 node label | NO invented label — do not lie in data. Heading-less cards keep an empty/group-only `heading_path`; the chunker gains `headingPrefix` to seed it. |

Sources: [Canvas spec (obsidian-api canvas.d.ts)](https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts),
[Canvas interaction functions — Obsidian forum](https://forum.obsidian.md/t/canvas-interaction-functions/51959),
[Feature request: link to a canvas card](https://forum.obsidian.md/t/canvas-ability-to-link-to-a-specific-group-a-selected-section-a-card-of-a-canvas/49779),
[Advanced Canvas plugin](https://community.obsidian.md/plugins/advanced-canvas),
[Enhanced Canvas plugin](https://community.obsidian.md/plugins/enhanced-canvas).
