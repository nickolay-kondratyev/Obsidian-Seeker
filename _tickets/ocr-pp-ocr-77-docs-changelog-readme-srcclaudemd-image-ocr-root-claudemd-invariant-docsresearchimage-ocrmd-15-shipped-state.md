---
id: nid_w2rhmbpwd634wv55m1top0n4g_e
title: "OCR PP-OCR 7/7: docs + change_log — README, src/CLAUDE.md §Image OCR, root CLAUDE.md invariant, docs/research/image-ocr.md §15 shipped state"
status: open
deps: [nid_jz9fvvhltomq9o9nmesc57zjb_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_4y2zlnfyt57qocu762lxdoiie_e, nid_bj4oo8zwshwaw8v3efwa4nnim_e, nid_v9z9mlhqtm2dek4a83y28no57_e, nid_54wu4qecgbvwswm5ty6uuq0z9_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_jz9fvvhltomq9o9nmesc57zjb_e, nid_24y96qrb1q8ndmdttvwkfb653_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T23:19:32Z
status_updated_iso: 2026-09-03T23:19:32Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, docs]
---

READ FIRST: the plan ticket (search `_tickets/` for "PLAN: PP-OCRv6-tiny default OCR engine") and the resolutions of tickets 1–6 (spike/§14, runner, fallback, settings, override, e2e). Then `README.md` (user docs: the OCR section), `src/CLAUDE.md` (architecture conventions — it has NO OCR section today), root `CLAUDE.md` (commands + global invariants), `docs/research/image-ocr.md` (§5, §11, §12, §13, §14 — the plan of record; check every statement that says "tesseract" as if it were the only engine), `$(change_log --help)`.

## Goal
Bring the stable documentation in line with the shipped state and record the change. Small ticket; no code beyond doc strings.

## Deliverables
1. `README.md`: Image OCR section rewritten for the final behaviour — on by default, desktop reads / phones search the synced cache, the fast engine (PP-OCRv6, multilingual, WebGPU when available, ~6 MB download from Hugging Face) with Tesseract fallback and what the warning means, the model picker (Tiny/Small/Medium/Custom) and that switching never re-reads existing images (use Rebuild), Clear vs Rebuild, skipped formats (svg, heic).
2. `src/CLAUDE.md`: add a SUCCINCT "§Image OCR" block (stable facts only): the `OcrEngine` contract and its ONE call site (`ocrPrepass`), the two runners + `FallbackOcrEngine`, "srcdoc iframes carry NO `sandbox` attribute" invariant, records under `<sidecar>/ocr/<sha256>.json` with provenance fields (`engine`, `v`, `langs`, `model`, `ep`) and the D2 rule (a hit is a hit; only Clear/Rebuild re-OCR), model catalogue + sha pinning, per-device fallback reason in localStorage, and the pointer to `docs/research/image-ocr.md` for the WHY.
3. Root `CLAUDE.md`: under Global invariants add one line: changing `src/ocr-model-catalogue.ts`'s pinned sha/paths changes what preset users download next load (Cache API evicts the old bytes) but never invalidates records.
4. `docs/research/image-ocr.md`: a short "§15 Shipped state (date)" mapping decisions D1–D13 of the plan ticket to files, and fix any §5/§11 sentence that now reads wrong (e.g. "language setting becomes inert" → "fallback-only").
5. `change_log` entry summarising the whole PP-OCR delivery (tickets 1–6) — one entry, not six.
6. Verify `versions.json`/`manifest.json` need nothing (release is cut by `./release.sh`, not here).

## Acceptance
- `npm run test` green (the `rename-plugin-id --check` and any doc-lint tests), `npm run typecheck` green.
- Diff is docs only (+ `change_log`).

