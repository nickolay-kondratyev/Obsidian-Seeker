---
closed_iso: 2026-09-03T19:11:57Z
id: nid_5nfsr4yj8anp4jggh0uoc9bbt_e
title: Image OCR - Research
status: closed
deps: []
links: [nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e, nid_l89twli61ofcev3vablmht1h9_e]
created_iso: '2026-09-02T23:20:49Z'
status_updated_iso: 2026-09-03T19:11:57Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [ocr, research]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-1
---
Images that are added into the notes to be processed.

Let's research the way to add image OCR processing.

The end goal is to add ./docs/research/image-ocr.md research document and discuss feasibility of adding without decreasing robustness.

I am thinking Image OCR would be OPT-IN and disabled by default. And we will want to make sure that we don't loose the OCR that we have done for images already (maybe use hashes of images so that if its exactly the same image copied again under different name even we would avoid doing OCR on it?).

## Notes

**2026-09-03T18:49:04Z**

Research written to docs/research/image-ocr.md (commit e1b2ad6). Six decisions for the human in §9 (scope of 'image', where a hit lands, cache format, language, engine, PDFs). Recommended next step: Phase-0 spike benching PP-OCRv6-tiny vs tesseract.js 7 on real vault screenshots (§10).

**2026-09-03T18:53:36Z**

Human decided Q1 (all images, referenced first), Q2 (one referrer → open note; else open image), Q6 (PDFs = follow-up). Open: Q3 cache format, Q4 language, Q5 engine (spike).

**2026-09-03T18:56:41Z**

Q3 decided: one JSON per image hash (not JSONL). Q4 decided: multilingual required → favours PP-OCR. Q5 open: PP-OCR primary vs tesseract.js fallback, spike to confirm.

**2026-09-03T19:02:31Z**

Decided: OCR cache under <sidecar index dir>/ocr/ (not .plugin_data — Obsidian Sync does not deliver non-.obsidian dot folders); no asset bundling possible (install fetches only main.js/manifest/styles); V1 = tesseract.js, PP-OCRv6-tiny recorded as follow-up §11.

**2026-09-03T19:11:57Z**

All decisions made (Q1–Q6, D1–D7); doc promoted to plan of record; tickets 0/4–3/4 + 2 follow-ups created and linked. Closing.

**2026-09-03T19:25:13Z**

Plan review 2026-09-03: corrected doc + tickets (no-sandbox iframe, OCR pre-pass, oracle no-re-read rule, Rebuild/Clear must invalidate FileRecords = §12 D8 pending human, failure taxonomy, decode in child). Added verify ticket nid_l89twli61ofcev3vablmht1h9_e (need-human).
