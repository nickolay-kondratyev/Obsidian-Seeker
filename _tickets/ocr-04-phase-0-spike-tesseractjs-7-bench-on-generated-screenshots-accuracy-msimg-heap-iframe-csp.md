---
id: nid_cuu1jus7e29gcqcp7xycfxhz1_e
title: "OCR 0/4: Phase-0 spike — tesseract.js 7 bench on generated screenshots (accuracy, ms/img, heap, iframe CSP)"
status: open
deps: []
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:11:39Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, bench]
---

Plan of record: docs/research/image-ocr.md (§10 Phase 0, §12 D7, §8a/§8c). Bench-first spike BEFORE any plugin code.

Deliverables:
1. scripts/ocr-fixtures.mjs (Playwright, like scripts/bench.mjs): renders HTML pages of KNOWN text and screenshots them into .out/ocr-fixtures/ with a ground-truth .txt per image. Vary: font family, font size 10–24 px, light/dark theme, deviceScaleFactor 1 and 2, code blocks, tables, chat bubbles, plus JPEG-compressed and slightly blurred variants. Commit only a SMALL subset (our own renders, licence-free) as test fixtures if needed.
2. scripts/ocr-spike.mjs: loads tesseract.js 7.0.0 from jsdelivr INSIDE a sandboxed srcdoc iframe (same CSP shape as src/iframe-runner.ts: Blob worker + remote importScripts + wasm-unsafe-eval — prove it loads), runs each fixture at 1x/2x/3x upscale, records ms/image, heap delta, word accuracy vs ground truth, per-word confidence distribution.
3. Results appended to docs/research/image-ocr.md as a new section: chosen resize window (§5/§12 D4), confidence + min-char thresholds (§6), pixel cap, and the CSP directives the OCR iframe needs.

Non-goals: PP-OCR (follow-up ticket), any src/ changes.

