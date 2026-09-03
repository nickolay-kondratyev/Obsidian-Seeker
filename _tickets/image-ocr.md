---
id: nid_5nfsr4yj8anp4jggh0uoc9bbt_e
title: Image OCR - Research
status: in_progress
deps: []
links: []
created_iso: '2026-09-02T23:20:49Z'
status_updated_iso: '2026-09-03T18:33:28Z'
type: task
priority: 3
assignee: nickolaykondratyev
tags: [decide, need-human]
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
