---
id: nid_kw23mrjlr2g4u56x96ierq100_e
title: "OCR 1/4: pure modules — ocr-cache (per-hash JSON), image gate, contentFor step, chunksFor image branch"
status: open
deps: [nid_cuu1jus7e29gcqcp7xycfxhz1_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:11:39Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr]
---

Plan of record: docs/research/image-ocr.md (§2a, §3, §4, §9 Q1/Q3, §12 D1–D3). Tests first, Obsidian-free where the canvas/base precedent is (src/canvas-extractor.ts, src/indexable-file.ts).

Scope:
- src/ocr-cache.ts: record type with provenance fields (§3 record), path = <sidecar index dir>/ocr/<sha256>.json, sha256 via crypto.subtle, lazy get/put, list for stats, explicit clear; a record is served regardless of engine/version/langs (§12 D2); deleted images keep their record (§12 D1).
- src/image-file.ts: V1 extension gate png/jpg/jpeg/webp/gif/bmp (§12 D3), decode via createImageBitmap with resize into the §12 D4 window and the pixel cap (numbers from the Phase-0 spike).
- src/indexable-file.ts: `image` case behind new setting indexImages (default OFF); update main.ts watcher + settings-tab total automatically via the shared gate.
- src/search.ts: a contentFor(file) step ahead of chunksFor (md/base/canvas → cachedRead; image → readBinary → sha256 → cache lookup → miss = OCR RPC on desktop / UNKNOWN on mobile); chunksFor image branch → chunkContent(text, path, title = basename WITH extension per §12 D5). FileRecord.contentHash = the sha256. Text-free image persists a FileRecord with chunk_ids [] (§4). collectLiveIds/reChunkLive treat a cache miss as incomplete/unknown, never as zero chunks (§4).
- Work-queue order: images referenced by a note (metadataCache.resolvedLinks at pass start) first, then unreferenced; ordering only, never membership (§9 Q1).

The OCR RPC itself is ticket 2/4; this ticket wires an interface (OcrEngine) with a test double.

