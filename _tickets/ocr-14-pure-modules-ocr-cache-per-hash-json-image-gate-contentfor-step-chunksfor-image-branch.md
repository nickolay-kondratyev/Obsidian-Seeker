---
closed_iso: 2026-09-03T20:27:38Z
session_ids: [{"a": "claude", "type": "execution", "id": "c44ea5fb-af1e-4ac9-810c-fff2733e45b3"}, {"a": "claude", "type": "review", "id": "b243ccf4-12cd-4bc5-85ab-0fd61e523a0d"}, {"a": "claude", "type": "review", "id": "f53cf332-4258-4c6b-958a-ad02bbeefbcc"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_kw23mrjlr2g4u56x96ierq100_e
title: "OCR 1/4: pure modules — ocr-cache (per-hash JSON), image gate, contentFor step, chunksFor image branch"
status: closed
deps: [nid_cuu1jus7e29gcqcp7xycfxhz1_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e, nid_l89twli61ofcev3vablmht1h9_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T20:27:38Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr]
---

READ FIRST (before any code): docs/research/image-ocr.md is the plan of record — read it in full, then re-read §2a, §3, §4 (every bullet is a requirement of this ticket), §5 "Pass integration", §9 Q1/Q3, §12 D1–D5, D8, and §13 (spike constants). Then read: src/indexable-file.ts, src/canvas-extractor.ts + src/canvas-indexing.test.ts (the pure-module + FakeVault precedent), src/index-store.ts `classifyFileDelta` + `FileRecord`, and in src/search.ts the `chunksFor` header comment plus every `cachedRead` call site (`grep -n cachedRead src/search.ts`) — those are the sites this ticket must route through `contentFor`. Do not deviate from the plan doc without recording the deviation in it.

Plan of record: docs/research/image-ocr.md (§2a, §3, §4, §5 pass integration, §9 Q1/Q3, §12 D1–D5, §13 numbers from the spike). Tests first, Obsidian-free where the canvas/base precedent is (src/canvas-extractor.ts, src/indexable-file.ts, the FakeVault harness in src/canvas-indexing.test.ts).

Scope:
- `src/ocr-cache.ts`: record type with the §3 provenance fields; path = `<sidecar index dir>/ocr/<sha256>.json` (the dir comes from main.ts `resolveSidecarIndexDir()`, passed in — the cache is written whether or not `sidecarEnabled` is on); sha256 via `crypto.subtle.digest`; lazy `get`/`put`, `list` for the status card, explicit `clear`. Hit rules (§12 D2): a TEXT or ERROR record is served regardless of engine/version/langs; there is no automatic miss on provenance mismatch and no automatic GC (§12 D1).
- `src/image-file.ts`: V1 extension gate png/jpg/jpeg/webp/gif/bmp (§12 D3; svg/heic are NOT indexable — they are counted separately for the status card), and a PURE `planResize(width, height) → { scale, targetW, targetH } | { reject: 'pixel-cap' }` implementing the §12 D4 window + pixel cap with the §13 constants. NO `createImageBitmap` here: decoding happens inside the OCR iframe (ticket 2/4) and vitest runs in node.
- `src/indexable-file.ts`: `image` case behind a new setting `indexImages` (default OFF, `IndexableGate` widened); `collectIndexableFiles` early-return must include the new gate. main.ts watcher + settings-tab total follow automatically.
- `src/search.ts` — a cache-only `contentFor(file)` step ahead of `chunksFor`: md/base/canvas → `cachedRead`; image → sha256 → cache lookup → hit = text, miss = UNKNOWN (never an engine call; the engine runs in the Phase-2 pre-pass). Route EVERY content-read site through it — `embedAndCommitFiles` (~1090), computeDelta's `check-bytes` branch (~1620), `reChunkLive`, `collectLiveIds`, `dedupViaSidecar`, `carryOverHydrate` — the same one-place rule `chunksFor` already enforces for ids. `chunksFor` image branch → `chunkContent(text, path, title = basename WITH extension, §12 D5)`.
- No-re-read rule (§4): for an image whose stored `FileRecord.mtimeMs === stat.mtime`, reuse the stored `contentHash` and do not read the bytes; read + hash only when there is no record or the mtime moved. Reuse `classifyFileDelta`'s decision, do not duplicate it. Test: an oracle sweep over N unchanged images performs 0 `readBinary` calls.
- UNKNOWN handling (§4): `collectLiveIds` → `complete:false` (never zero chunks); `reChunkLive`/`dedupViaSidecar`/`carryOverHydrate` → skip the file; `embedAndCommitFiles` → skip WITHOUT quarantine and WITHOUT a FileRecord, counted as "waiting for OCR" for the status card. `FileRecord.contentHash` for images = the sha256. A text-free image (record with `text: ""`) or an `error` record persists a FileRecord with `chunk_ids: []` (§4) — extend the zero-chunk path, which today deletes the record.
- `OcrEngine` interface (`ocr(bytes: ArrayBuffer) → OcrResult`) + a test double; `ocrPrepass(files)` skeleton that hashes, skips hits, calls the engine on misses, writes records, and memoises `path → sha256` for the pass. Queue order as a pure comparator with tests: referenced-by-a-note first (from `metadataCache.resolvedLinks` snapshotted at pass start, ordering only — §9 Q1), most-recent-first within each group.
- Invalidation helper used by Clear/Rebuild (§12 D8): drop every image FileRecord + rows via `store.deleteFile(path)` so the next pass re-chunks them. Test: after Rebuild the image's new text produces new chunk_ids in the index.

Tests to add (BDD, one assert each): gate + collect; cache get/put/list/clear + hit-regardless-of-provenance; planResize window/cap; contentFor per extension; chunk_id parity between the index write path and each oracle for an image; no-re-read; unknown-on-miss for each oracle; zero-chunk FileRecord for empty text and for error records; queue comparator; invalidation.

Acceptance: `npm run test` + `npm run typecheck` green; `indexImages` OFF leaves every existing test and the analyzer hash untouched (no bm25/tokenize/prop-normalize edits).

---

## Resolution (2026-09-03)

DONE. `npm run test` (1442 passed / 19 skipped) + `npm run typecheck` green. No
edits to `src/bm25.ts` / `src/tokenize.ts` / `src/prop-normalize.ts` → analyzer
hash untouched; `indexImages` defaults OFF so every existing test is unchanged.

### New pure modules
- `src/image-file.ts` (+ `src/image-file.test.ts`): V1 extension gate
  (`isIndexableImageExtension` png/jpg/jpeg/webp/gif/bmp; `isSkippedImageExtension`
  svg/heic), pure `planResize(w,h)` with the §13 constants
  (`RESIZE_MIN/MAX_LONG_EDGE_PX` 2000/3000, `PIXEL_CAP` 25 MP → `{reject:'pixel-cap'}`),
  and the pure `compareOcrQueue` comparator (referenced-first, then most-recent).
  No `createImageBitmap` (decode is the iframe's job, ticket 2/4).
- `src/ocr-cache.ts` (+ `src/ocr-cache.test.ts`): `OcrRecord` with the §3
  provenance fields; `sha256Hex` via `crypto.subtle.digest`; `OcrCache` over a
  structural `OcrCacheAdapter` (Obsidian's DataAdapter satisfies it) writing
  `<sidecarIndexDir>/ocr/<sha256>.json`; lazy `get`/`has`/`put`, `list` (status
  card), `clear`; `ocrText(rec)` (error/empty → `''`). Hit rule D2: any existing
  record is served regardless of provenance; no auto-GC/auto-miss. `OcrEngine`
  interface (`engine`/`version`/`langs` + `ocr(bytes)→OcrResult`).

### Gate + setting
- `src/indexable-file.ts`: `IndexableGate` widened with `indexImages`; the image
  `default` case + the `collectIndexableFiles` early-return both gate on it. The
  main.ts watcher and settings-tab total follow automatically (they pass
  `this.settings`). Tests updated in `src/indexable-file.test.ts`.
- `src/types.ts`: `indexImages: boolean` (DEFAULT_SETTINGS `false`; additive, no
  migration — `Object.assign` backfills, like `altOpenLocation`).

### search.ts integration (the one-place rule)
- `contentFor(file, prev?)` — the single content-read step ahead of `chunksFor`:
  md/base/canvas → `cachedRead` + cyrb53; image → `imageContentHash` (no-re-read)
  → `OcrCache.get` → hit = `{kind:'text', text, contentHash}` (text-free/error →
  `text:''`), miss = `{kind:'unknown', contentHash}`. Throws only on a genuine
  read failure. Returns `FileContent` type. Routed through EVERY read site:
  `embedAndCommitFiles`, `computeDelta` check-bytes, `reChunkLive`,
  `collectLiveIds`, `dedupViaSidecar`, `carryOverHydrate`.
- `imageContentHash` reuses `classifyFileDelta`'s clean-mtime decision to reuse
  the stored sha256 (`FileRecord.contentHash`) and skip `readBinary` when
  `mtime` matches — the §4 no-re-read rule. Also consults a pass-scoped
  `ocrHashMemo`.
- `chunksFor` image branch: gates on `cleanDenseBody(text).length >= minChunkChars`
  (same threshold as a canvas card) BEFORE `chunkContent(text, path, title =
  basename WITH extension)`. NOTE (non-obvious): the min-chars gate is REQUIRED —
  without it `chunkContent` emits its title-only lexical fallback for an empty
  image, which is exactly the filename-as-vector ranking pollution §6 forbids;
  gating routes a text-free image to zero chunks → the clean `chunk_ids:[]`
  FileRecord.
- UNKNOWN handling: `collectLiveIds` → `complete:false`; `reChunkLive` /
  `dedupViaSidecar` / `carryOverHydrate` → skip; `embedAndCommitFiles` → skip
  WITHOUT quarantine/record, counted as `filesWaitingOcr` (surfaced as a check
  line + `index-ocr-waiting` forensics beat). Zero-chunk IMAGE (empty/error) →
  the zero-chunk branch now writes a `chunk_ids:[]` FileRecord with the sha256 in
  BOTH modes instead of only deleting.
- `ocrPrepass(files)` skeleton (desktop-only, no-op unless `setOcrEngine` wired):
  orders via `compareOcrQueue` over a `metadataCache.resolvedLinks` snapshot
  (ordering only, §9 Q1), hashes + memoises path→sha256, skips cache hits, calls
  the engine on misses, writes records with provenance. Transient throw → no
  record (retried); returned `error` → error record (final until Rebuild).
- `invalidateImageRecords()` for Clear/Rebuild (§12 D8): drops every image
  FileRecord + rows via `store.deleteFile` and bumps the cache generation.

### Pass-scoped memo correctness
`ocrHashMemo` is cleared at pass entry (`reindexAllInner`, `computeDelta`) and at
each standalone-pass oracle (`reChunkLive`, `collectLiveIds`) so a prior pass's
hash can never serve a since-edited image; `dedupViaSidecar`/`carryOverHydrate`
are same-pass consumers and deliberately do NOT clear it. Each entry also carries
the mtime it was hashed at and is served only while the live mtime still matches
(review fix): an image edited between the pre-pass/computeDelta hash and the
embed loop within one drain burst was otherwise committed with the OLD bytes'
text under the NEW mtime and read 'clean' until its next edit. Pinned by the
"pass-scoped hash memo" scenario in `src/image-indexing.test.ts`.

### Test harness
`src/test-harness/fake-vault.ts` gained image bytes (`writeImage`/`readBinary` +
a `readBinaryCalls` counter for the no-re-read oracle) and a working in-memory
`FakeAdapter`. `scenario.ts` `boot(settings, { indexDir, ocrEngine })` +
`ocrColdStart()` + `fakeOcrEngine()`/`encodeImage()` (bytes ARE the text; `ERR:`
prefix → error record). New scenario tests: `src/image-indexing.test.ts` (16),
`src/ocr-prepass.test.ts` (7).

### Deferred to ticket 2/4 (as scoped)
The OCR iframe runtime + decode/`planResize` application, the real `ocrPrepass`
wiring into `reindexAll`/delta, the settings toggle/language picker/status card,
and the Clear/Rebuild buttons. `contentFor` is cache-only on every platform, so
those are additive.

## Notes

**2026-09-03T20:32:58Z**

__REVIEW_AGAIN__: No defects found and checks pass (typecheck + 1442 tests green), but the ~290-line search.ts integration threads through the core reindex/delta/hydrate pipeline — first-round policy warrants a second independent pass on that surface.

**2026-09-03T20:36:51Z**

__READY_AS_IS__: second pass found one real defect (stale path-keyed image hash memo could commit old OCR text under a new mtime); fixed with a failing-first scenario test, memo now mtime-validated; typecheck + 1443 tests green.
