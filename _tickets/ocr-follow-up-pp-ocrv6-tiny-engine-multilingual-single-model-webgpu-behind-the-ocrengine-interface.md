---
id: nid_ybv5cljnxx9wb4ha2gbvpsbmd_e
title: "OCR follow-up: PP-OCRv6-tiny engine (multilingual single model, WebGPU) behind the OcrEngine interface"
status: open
deps: [nid_b4wvgo11kfiba3cojrj9q95cy_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:11:39Z
type: feature
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, perf]
---

Plan of record: docs/research/image-ocr.md §11 (why, what changes, delivery, adoption gate). Re-run the Phase-0 harness (scripts/ocr-spike.mjs) with PP-OCRv6-tiny via ppu-paddle-ocr/web loaded in the srcdoc iframe; adopt only if accuracy ≥ tesseract.js on the same fixtures, loads from a CDN without COOP/COEP, and the wrapper is maintained or thin enough to vendor. Host model files on a URL this project controls. Existing cache records stay valid (§12 D2); the language setting becomes inert.

