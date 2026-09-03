---
id: nid_5nfsr4yj8anp4jggh0uoc9bbt_e
title: "Image OCR - Research"
status: p3
deps: []
links: []
created_iso: 2026-09-02T23:20:49Z
status_updated_iso: 2026-09-02T23:20:49Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

Images that are added into the notes to be processed.

Let's research the way to add image OCR processing.

The end goal is to add ./docs/research/image-ocr.md research document and discuss feasibility of adding without decreasing robustness.

I am thinking Image OCR would be OPT-IN and disabled by default. And we will want to make sure that we don't loose the OCR that we have done for images already (maybe use hashes of images so that if its exactly the same image copied again under different name even we would avoid doing OCR on it?).  