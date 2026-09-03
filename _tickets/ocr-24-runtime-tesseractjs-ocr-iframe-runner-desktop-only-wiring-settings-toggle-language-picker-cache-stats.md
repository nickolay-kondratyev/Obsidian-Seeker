---
id: nid_c9vuyt7b0e88sq8ljtu8b19le_e
title: "OCR 2/4: runtime — tesseract.js OCR iframe runner, desktop-only wiring, settings toggle + language picker + cache stats"
status: open
deps: [nid_kw23mrjlr2g4u56x96ierq100_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:11:39Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr]
---

Plan of record: docs/research/image-ocr.md (§5, §7, §8a, §9 Q4/Q5, §12 D1/D2/D4). Depends on the Phase-0 spike numbers and the 1/4 modules.

Scope:
- src/ocr-iframe-runner.ts: SECOND sandboxed srcdoc iframe (id seeker-ocr-iframe) hosting tesseract.js 7 from jsdelivr (workerPath/corePath/langPath explicit, Cache-API caching of core + language packs), RPC with timeout + recycle mirroring src/iframe-runner.ts, one worker, sequential, torn down when the OCR queue drains (wasm heap never shrinks — §8a). Never instantiated on mobile (Platform.isMobile) — phones read the cache only.
- Pass integration: OCR the delta's images FIRST, tear the iframe down, then embed (peak memory = max, not sum). Pace through src/pacer.ts idle gate. Decode/OCR failure → cache record with error + provenance (retry once per engine bump, mirroring embedFailPluginVersion).
- Settings (src/settings-tab.ts): "Index text in images (OCR)" toggle default OFF with desktop-only copy; language multi-select (default Obsidian locale + English; a change never re-OCRs — §12 D2); status card: OCR progress N/M, cache count + MB, skipped heic/svg counts; buttons "Rebuild OCR cache" and "Clear OCR cache" (explicit, separate from full reindex).
- README section.

