---
closed_iso: 2026-09-03T21:18:51Z
session_ids: [{"a": "claude", "type": "execution", "id": "5b2316ea-7331-427b-b752-2dd1797f4400"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_b4wvgo11kfiba3cojrj9q95cy_e
title: "OCR 3/4: search-modal open branch (one referrer → note, else image) + in: Note line"
status: closed
deps: [nid_c9vuyt7b0e88sq8ljtu8b19le_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e, nid_l89twli61ofcev3vablmht1h9_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T21:18:51Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, ui]
---

READ FIRST (before any code): docs/research/image-ocr.md is the plan of record — read §2a, §9 Q2, §12 D5 (and skim the rest). Then read src/canvas-open.ts + src/canvas-open.test.ts (the guaranteed-open / best-effort-position pattern and the fake-leaf test pattern) and the `.base` / `.canvas` open branch in src/search-modal.ts. Do not deviate from the plan doc without recording the deviation in it.

Plan of record: docs/research/image-ocr.md (§2a, §9 Q2, §12 D5). Depends on 2/4 (image documents exist in the index).

Scope (src/search-modal.ts, new src/image-open.ts mirroring src/canvas-open.ts):
- On open of an image result: reverse-lookup referrers from `app.metadataCache.resolvedLinks` at OPEN time (nothing stored in the index). Exactly one referencing note → `openFile(note)` + best-effort scroll to the line holding the embed (locate `![[...]]` / `![](...)` resolving to that path in the raw text; guaranteed open, best-effort position, same split as canvas-open.ts). Zero or several → `openFile(image)`.
- Result row: title keeps the extension (already true from 1/4's `chunksFor`), snippet = OCR passage, one-line "in: <Note>" when exactly one referrer (computed at render time from `resolvedLinks`, cheap: one reverse scan per result page).
- Skip the markdown highlight/scroll path for image files like .base/.canvas do.
- Pure helpers with unit tests: `referrersOf(imagePath, resolvedLinks)` and `embedLineFor(noteText, imagePath)` (wiki + markdown embeds, with and without alias/size suffix, encoded spaces in markdown links).

Acceptance: `npm run test` + `npm run typecheck` green; the fake-leaf test pattern from src/canvas-open.test.ts covers open-note, open-image, and scroll-failure-still-opens.

---

## Resolution (2026-09-03)

Done. `npm run test` (1488 pass), `npm run typecheck`, and `npm run build` all green.

### What was built

**`src/image-open.ts`** (new, mirrors `canvas-open.ts`) + **`src/image-open.test.ts`**:
- `ImageResultOpener.open(leaf, image, target, active)` — the guaranteed-open /
  best-effort-position half. `target: ImageOpenTarget` is either `{ kind: 'image' }`
  (open the image file) or `{ kind: 'note', note, line }` (open the note, and when
  `line != null` scroll to it). Outcomes: `opened-image`, `opened-note`,
  `opened-note-top` (one referrer but no embed line / no editor), `scroll-failed`
  (editor threw — note stays open, ONE diagnostics line). Scroll uses a
  feature-detected editor (`setCursor`/`scrollIntoView`), NOT `instanceof
  MarkdownView`, so the module is fake-leaf testable and preview/not-ready views
  are a clean no-op — the same "hostile internals" discipline as canvas-open.
- Pure helpers (Obsidian-free, unit-tested): `referrersOf(imagePath,
  resolvedLinks)` (exact full-path key match against `resolvedLinks`) and
  `embedLineFor(noteText, imagePath)` (0-based line of the first `![[…]]` / `![](…)`
  embed; handles wiki alias/size suffix, markdown `%20`-encoded and
  `<angle-bracketed>` paths + titles, short-basename vs full-path targets).

**`src/search-modal.ts`**:
- New image branch in `openResult` (after `.base`/`.canvas`, before the markdown
  highlight path): `isIndexableImageExtension(file.extension)` → `resolveImageTarget`
  → `imageOpener.open`. Same modal semantics as canvas (background alt-open keeps
  the modal focused; plain open dismisses).
- `resolvedLinks()`, `soleReferrer(imagePath)` (one referrer or null),
  `resolveImageTarget(image)` (reads the sole referrer note text via `cachedRead`
  to locate the embed line; a read failure just drops the scroll), and
  `imageReferrerLine(notePath)` (`"in: <Note>"` or `''`).
- Render: a new reconciled `referrerEl` row line (tracked by `lastReferrer`, like
  `lastCrumb`) shows `"in: <Note>"` for an image result with exactly one referrer.
  Title already keeps the extension (`noteTitle` only strips `.md`).

**`styles.css`**: `.seeker-result-in` (faint single clipped line).

### Notes for the next reader
- Referrers are resolved READ-SIDE at open + render time from
  `metadataCache.resolvedLinks`; nothing about referrers is stored in the index, so
  link edits never touch it (§2a/§9 Q2).
- Basename matching in `embedLineFor` is intentionally lenient (case-insensitive):
  the referrer note is already known from `resolvedLinks`, so locating the line is
  pure best-effort and can't select a wrong file.
- No deviations from the plan of record.
