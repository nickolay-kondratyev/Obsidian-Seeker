---
id: nid_w5o7slkuv2qgl3oma5q9a4grh_e
title: "OCR follow-up: SVG text extraction (XML <text>, no OCR)"
status: open
deps: [nid_b4wvgo11kfiba3cojrj9q95cy_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:11:39Z
type: feature
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ocr]
---

Plan of record: docs/research/image-ocr.md (§5 formats, §12 D3). After images ship: treat .svg as an indexable file whose content is the concatenated <text>/<tspan> nodes (pure extractor, like src/base-extractor.ts). No OCR engine involved; still an own-document per file; cache not needed (pure function of bytes).

