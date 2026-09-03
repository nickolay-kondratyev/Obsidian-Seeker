# Canvas search — research & plan

Status: PLAN OF RECORD, post-rebase review in §6 (research ticket `nid_q2cjfljs5iios4c6gzb3unol2_e`,
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
within a note) and that row carries NO `canvas_node_id` (ambiguous → open the
canvas, §6 R1). The only new field is the optional `canvas_node_id`, present
solely on canvas long-card rows → **no `CHUNKER_VERSION` / `DB_VERSION` bump**
(no pre-existing row changes shape); existing indexes pick canvases up on the next startup delta because
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
2. Only for a long-card chunk: the node id is `r.canvas_node_id`, stored on
   the chunk at index time (§6 R1, decided). Absent (map chunk, or a chunk whose
   content is shared by several cards) → stop, opened. Node id not in the open
   canvas (card deleted since indexing) → stop, opened. Rule: when in doubt,
   land on the canvas, never on a wrong node.
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
| Q7 click → node (§6 R1) | Store `canvas_node_id` on unambiguous long-card chunks; never re-derive ids at click time. Ambiguous or missing → open the canvas, never a wrong node. |
| Q8 result title (§6 R5) | Show "Roadmap.canvas" as-is; the extension is useful signal. |

Sources: [Canvas spec (obsidian-api canvas.d.ts)](https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts),
[Canvas interaction functions — Obsidian forum](https://forum.obsidian.md/t/canvas-interaction-functions/51959),
[Feature request: link to a canvas card](https://forum.obsidian.md/t/canvas-ability-to-link-to-a-specific-group-a-selected-section-a-card-of-a-canvas/49779),
[Advanced Canvas plugin](https://community.obsidian.md/plugins/advanced-canvas),
[Enhanced Canvas plugin](https://community.obsidian.md/plugins/enhanced-canvas).

## 6. Post-rebase review (2026-09-03, after rebasing onto `main` @ 824b43a)

The rebase brought in the lever-1/2 revert (batching/pacing) and the
`seek → seeker` id migration. Neither touches the chunker, `chunksFor`,
`isIndexableFile`, the `.base` modal branch, or `BaseView` — every symbol §3c
names was re-verified against the tree, so §3 stands. The review below is
about robustness gaps in the plan itself, not rebase drift.

### R1 — click-time `chunk_id` re-derivation is NOT sound (decided: option A)

`enforceTokenBudget` (`src/token-budget.ts:362`) re-splits any section over the
512-token budget and gives each part a NEW `chunk_id` hashed from the part's
content. A "long card" is exactly the card most likely to exceed the budget, so
the extractor + `chunkCanvas` alone cannot reproduce the stored id — the real
producer path is `chunksFor` THEN `enforceTokenBudget` (async, needs the
tokenizer; `reChunkLive` shows the shape). Options:

- **A (DECIDED 2026-09-03): carry the node id on the chunk.** Add optional
  `canvas_node_id?: string` to `Chunk`, set by `chunkCanvas` on long-card
  chunks only, NOT hashed into `chunk_id`. It flows for free: `ChunkMeta` is
  `Omit<Chunk,'content'>` (IDB `chunk_meta` stores it generically), the
  token-budget split spreads `...chunk` onto parts, the sidecar stores only
  vectors by id and re-derives meta locally, and the chunk-diff (`search.ts`
  ~2155, `chunkMetaEqual` → `metaPatchSink`) already patches meta on unchanged
  ids, so a card re-created under a new node id with identical text updates
  the stored id without a re-embed. No `CHUNKER_VERSION`/`DB_VERSION` bump: the
  field is absent on every pre-existing row by construction (no canvas rows
  existed). Click = read `r.canvas_node_id`, zero parse. This amends the
  "no persisted-shape change" line in §3a to "no change to existing rows".
  Human's rider: only store the id when the chunk is UNAMBIGUOUSLY one card —
  when several docs in one canvas re-derive the same `chunk_id` (duplicate
  cards), `chunkCanvas` clears the field on that row. When in doubt, open the
  canvas rather than a wrong node.
- B (open-canvas-only in v1) — rejected.

`findCanvasNodeForChunk` is deleted under either option.

### R2 — map document must be injection-safe (decided: bullets)

Card text is dropped "verbatim" into a synthetic markdown doc that the chunker
parses. A short card starting with `# `, ```` ``` ````, `---`, `> ` or `|` would
open a heading / fence / frontmatter / callout / table and corrupt every
section after it (`atoms.ts` `HEADING_RE` / `FENCE_OPEN_RE` are column-0
anchored). Fix: each map item is ONE line, internal newlines collapsed to
spaces, prefixed `- `, and items are separated by a BLANK line so each is its
own paragraph atom (a 300-item preamble then splits cleanly at atom boundaries
instead of forcing the token budget's in-atom hard split). Group labels used as
headings are likewise collapsed to one line; an empty/whitespace label is an
unlabelled group. Heading level is `min(depth, 6)` (`HEADING_RE` stops at 6);
deeper chains keep their full names in `groupChain` on long cards but the map
heading_path truncates — documented, tested, accepted (7-deep nesting is
theoretical).

### R3 — short/long threshold must use the CLEANED length (decided)

The chunker's `minChunkChars` gate runs on `cleanDenseBody(section)`
(`chunker.ts` emit), not raw text. A card that is 200 raw chars of
`![[img.png]]`/URLs cleans to ~0 and would hit the title-only fallback as a
near-empty standalone vector — the exact hazard folding exists to avoid. The
extractor therefore classifies on `cleanDenseBody(text).length >= minChunkChars`
(pure import from `dense-clean.ts`; threshold passed in from the chunker, one
constant). Cards that clean to empty go to the map as their raw line so
`link_terms` reclaims the embed/URL.

### R4 — `headingPrefix` must reach every emit site (decided)

`chunkContent` has three id/emit sites (section emit, carry backward-fold, and
the title-only fallback at ~line 426). All three must prepend the prefix to
`heading_path` and build the title as `<canvas> > <prefix…> [> headings…]`;
the fallback currently hard-codes `heading_path: []`. Test each site.

### R5 — display title and insert-link strip only `.md` (decided: keep `.canvas` visible)

`search-modal.ts` `noteTitle()` (~line 118) and `insert-link.ts`
`noteBasename()` both do `replace(/\.md$/i, '')`, so a canvas result would be
listed as "Roadmap.canvas" (as `.base` results are listed as "Foo.base" today).
- Result-list title: DECIDED (2026-09-03) — no change; "Roadmap.canvas" is
  shown on purpose, the extension tells the user it is a canvas result (same
  as `.base` today).
- Insert link (`⌘K`-style link insertion): `generateMarkdownLink` handles the
  extension itself; the no-active-file fallback must KEEP `.canvas` (Obsidian
  requires `[[x.canvas]]`), and the subpath must be EMPTY for `.canvas`
  (`#Group` is not a valid canvas subpath; bases do accept `#View`). Decided.

### R6 — open with `leaf.openFile` (decided)

`.canvas` is a core-registered extension, so `leaf.openFile(file, { active })`
(public API) is the fallback, not `setViewState({ type: 'canvas' })`; the base
branch only needs `setViewState` to pass `viewName`. Then feature-detect
`leaf.view.canvas` for the zoom step. The canvas view may not have its nodes
ready synchronously after `openFile` resolves — one `requestAnimationFrame`
retry is the ceiling; no polling.

### R7 — smaller robustness items (decided, folded into tickets)

- Per-node guards: `nodes`/`edges` non-array, node missing numeric
  `x/y/width/height` → treated as ungrouped; non-string `text`/`label`/`file`/
  `url` → skipped. Never throw; worst case = name-only map doc.
- Edge attribution when `fromNode` is a group: the group's own chain
  (including itself). Unknown `fromNode` id → preamble.
- Frontmatter inside a card is parsed by `chunkContent` as-is (tags/properties
  attach to that card's chunks under the canvas path). Rare and harmless;
  no special-casing.
- Settings copy: the delta path picks up / drops canvases on the next
  startup or catch-up sweep (`computeDelta`: not-in-live-set ⇒ deleted), so
  the toggle description should say "next catch-up", not "next full reindex".
- Ticket 2's drag/resize check should also assert the burst produces zero
  `adds`/`removed` (only a file-record mtime write), not just "no embed".
