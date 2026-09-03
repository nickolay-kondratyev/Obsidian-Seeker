---
id: nid_l89twli61ofcev3vablmht1h9_e
title: "OCR verify: tesseract.js iframe loads in a real Obsidian vault (CSP, Blob worker, jsdelivr, language pack), end-to-end search hit"
status: open
deps: [nid_c9vuyt7b0e88sq8ljtu8b19le_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e]
created_iso: 2026-09-03T19:23:34Z
status_updated_iso: 2026-09-03T19:23:34Z
type: chore
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, need-human]
---

READ FIRST: docs/research/image-ocr.md §5 (iframe shape) and §10 Phase 2, plus the ticket 2/4 notes for anything the implementation changed.

Plan of record: docs/research/image-ocr.md (§5, §10 Phase 2). The Phase-0 spike (scripts/ocr-spike.mjs) and the Phase-2 unit tests prove the OCR iframe in Playwright Chromium, NOT under Obsidian's real renderer CSP. The sandbox has no Obsidian, so only the human can close this.

Manual check (human, current Obsidian desktop, plugin built from the Phase-2 branch):
1. Settings → enable "Index text in images (OCR)"; leave the language default. Open the developer console (Ctrl/Cmd-Shift-I).
2. Paste a screenshot with readable text into a note (Obsidian writes `Pasted image ….png`). Wait for the catch-up (or run the OCR rebuild button).
   Expected: no CSP violation lines in the console for `seeker-ocr-iframe` (Blob worker, jsdelivr importScripts, wasm), the status card shows OCR progress reaching N/N and a cache count ≥ 1, and `<sidecar index dir>/ocr/<sha256>.json` exists with non-empty `text`.
3. Search for a phrase from the screenshot. Expected: the image (or its single referring note) is a result; opening it lands on the note scrolled to the embed.
4. Copy the image file under a new name (Finder/Explorer). Expected: no second OCR run (cache hit; the status card count does not grow), the copy is searchable after the catch-up.
5. Toggle OCR off. Expected: image results disappear after the next catch-up; the cache files remain.

Record outcomes as a note on this ticket; any CSP directive the iframe needed beyond what src/iframe-runner.ts uses goes into docs/research/image-ocr.md §5.

