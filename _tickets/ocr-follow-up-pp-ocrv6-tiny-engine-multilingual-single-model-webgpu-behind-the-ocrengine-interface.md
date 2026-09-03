---
id: nid_ybv5cljnxx9wb4ha2gbvpsbmd_e
title: "OCR follow-up: PP-OCRv6-tiny engine (multilingual single model, WebGPU) behind the OcrEngine interface"
status: follow-up
deps: [nid_5zn22onkawouvyt69fp11hjs0_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_l89twli61ofcev3vablmht1h9_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:11:39Z
type: feature
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, perf]
---

READ FIRST: docs/research/image-ocr.md in full, especially §8a/§8d, §11 (why, what changes, adoption gate), §12 D2, §13 (the tesseract.js baseline numbers to beat); then scripts/ocr-spike.mjs (the harness to re-run) and src/ocr-iframe-runner.ts (the `OcrEngine` implementation to mirror).

Plan of record: docs/research/image-ocr.md §11 (why, what changes, delivery, adoption gate). Re-run the Phase-0 harness (scripts/ocr-spike.mjs) with PP-OCRv6-tiny via ppu-paddle-ocr/web loaded in the srcdoc iframe; adopt only if accuracy ≥ tesseract.js on the same fixtures, loads from a CDN without COOP/COEP, and the wrapper is maintained or thin enough to vendor. Host model files on a URL this project controls. Existing cache records stay valid (§12 D2); the language setting becomes inert.

I am thinking to make sure this is working we will want to have real obsidian E2E tests, to make sure this model is actually running so before we get into OCR we will want to have separate ticket for real E2E obsidian test. See '/Users/nkondrat/vintrin-env/config/claude/ai_input/deep/obsidian-how-to-setup-e2e-test.md' memory for how to setup E2E test. Also I am thinking as part of this work we will want to enable OCR by default (and have an OPT OUT setting). And this `PP-OCRv6-tiny` will be the default with teseract as fallback, if we have to fallback we also want to display a warning in settings and in as the pop up toast in main obsidian.  REfer to ticket: nid_5zn22onkawouvyt69fp11hjs0_e which will have the test setup.