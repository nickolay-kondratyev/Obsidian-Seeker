---
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_cuu1jus7e29gcqcp7xycfxhz1_e
title: "OCR 0/4: Phase-0 spike — tesseract.js 7 bench on generated screenshots (accuracy, ms/img, heap, iframe CSP)"
status: in_progress
deps: []
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e, nid_l89twli61ofcev3vablmht1h9_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:39:54Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, bench]
---

READ FIRST (before any code): docs/research/image-ocr.md is the plan of record — read it in full, then re-read §5 (decode + resize, iframe shape), §6 (thresholds to measure), §8a/§8c (tesseract.js facts), §10 Phase 0, §12 D4 + D7. Then read scripts/bench.mjs and bench/harness/run.mjs (the harness shape to copy) and the LOAD-BEARING no-`sandbox` comment in src/iframe-runner.ts (search for "LOAD-BEARING"). Do not deviate from the plan doc without recording the deviation in it.

Plan of record: docs/research/image-ocr.md (§10 Phase 0, §12 D7, §8a/§8c, §5 decode + resize). Bench-first spike BEFORE any plugin code. Follows the shape of scripts/bench.mjs + bench/harness/run.mjs (Playwright Chromium, network access to the CDN, results as NDJSON).

Deliverables:
1. `scripts/ocr-fixtures.mjs` (Playwright): renders HTML pages of KNOWN text and screenshots them into `.out/ocr-fixtures/` (git-ignored) with a ground-truth `.txt` per image. Vary: font family, font size 10–24 px, light/dark theme, deviceScaleFactor 1 and 2, code blocks, tables, chat bubbles, plus JPEG-compressed and slightly blurred variants. Nothing is committed: the fixtures regenerate from the script, and the Phase-1 unit tests need no images (they hash arbitrary bytes).
2. `scripts/ocr-spike.mjs`: loads tesseract.js 7.0.0 from jsdelivr INSIDE a srcdoc iframe with NO `sandbox` attribute (mirror the LOAD-BEARING comment in src/iframe-runner.ts; a sandboxed iframe has an opaque origin and loses the Cache API). Explicit `workerPath` / `corePath` / `langPath`; prove the Blob worker + remote `importScripts` + wasm load. The child receives the image as a transferred ArrayBuffer and decodes it with `createImageBitmap` (the shape §5 fixes for the plugin). Runs each fixture at 1x/2x/3x upscale and records ms/image, heap delta (CDP `Performance.getMetrics` JSHeapUsedSize before/after, and after worker terminate — confirms the "heap never shrinks" claim in §8a), word accuracy vs ground truth, per-word confidence distribution. Also measure a second language pack (e.g. `deu`) loaded alongside `eng`: load time and ms/image delta, since §9 Q5 makes the language multi-select a V1 feature.
3. Results appended to docs/research/image-ocr.md as a new section "§13 Phase-0 results": chosen resize window + pixel cap (§5/§12 D4), per-word confidence floor + whole-image min mean-confidence + min-char thresholds (§6), the worker/CSP shape the OCR iframe needs, and the heap figures that justify teardown-after-drain.

Acceptance: `node scripts/ocr-spike.mjs` runs end-to-end in this container; the §13 numbers are in the doc; ticket 1/4 can read every constant it needs (resize window, pixel cap, thresholds) from §13.

Non-goals: PP-OCR (follow-up ticket nid_ybv5cljnxx9wb4ha2gbvpsbmd_e), any src/ changes, proving Obsidian's real CSP (that is nid_l89twli61ofcev3vablmht1h9_e after 2/4).
