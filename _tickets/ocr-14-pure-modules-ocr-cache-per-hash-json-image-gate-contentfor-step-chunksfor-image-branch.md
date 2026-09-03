---
id: nid_kw23mrjlr2g4u56x96ierq100_e
title: "OCR 1/4: pure modules — ocr-cache (per-hash JSON), image gate, contentFor step, chunksFor image branch"
status: open
deps: [nid_cuu1jus7e29gcqcp7xycfxhz1_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e, nid_l89twli61ofcev3vablmht1h9_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:11:39Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr]
---

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
