---
id: nid_24y96qrb1q8ndmdttvwkfb653_e
title: "OCR follow-up (need-human): mirror the PP-OCRv6 model files under the author's account; flip OCR_MODEL_REPO/REVISION in src/ocr-model-catalogue.ts"
status: open
deps: [nid_bj4oo8zwshwaw8v3efwa4nnim_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_4y2zlnfyt57qocu762lxdoiie_e, nid_bj4oo8zwshwaw8v3efwa4nnim_e, nid_v9z9mlhqtm2dek4a83y28no57_e, nid_54wu4qecgbvwswm5ty6uuq0z9_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_jz9fvvhltomq9o9nmesc57zjb_e, nid_w2rhmbpwd634wv55m1top0n4g_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T23:19:32Z
status_updated_iso: 2026-09-03T23:19:32Z
type: chore
priority: 4
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, need-human]
---

Context: the plan ticket (search `_tickets/` for "PLAN: PP-OCRv6-tiny default OCR engine") decided the PP-OCR model files load from the UPSTREAM Hugging Face repo `snowfluke/ppu-paddle-ocr-models` pinned to commit `bf1d5edb0335d3262be7caf13f766ba274b4cadd` (same pattern as the embedding model, `onnx-community/...` in `src/iframe-runner.ts`). `docs/research/image-ocr.md` §11 originally asked for a host this project controls; that is deferred to this ticket.

Risk covered: the upstream maintainer deletes/renames the repo. Cache API copies keep working on devices that already downloaded; new installs would fall back to Tesseract with the warning until a patch release moves the constant.

HUMAN steps (needs your accounts; the agent cannot do this):
1. Create a mirror under your account — either a Hugging Face model repo (e.g. `<you>/seeker-ocr-models`) or a small GitHub repo served through jsdelivr (`https://cdn.jsdelivr.net/gh/<you>/seeker-ocr-models@v1/...`). Copy, unchanged, from the pinned commit: `detection/ort/PP-OCRv6_tiny_det.ort`, `recognition/ort/PP-OCRv6_tiny_rec.ort`, `recognition/ppocrv6_tiny_dict.txt`, and (if you want the Small/Medium presets to keep working under the mirror) the `PP-OCRv6_small_*` / `PP-OCRv6_medium_*` files and `recognition/ppocrv6_dict.txt`. Keep the Apache-2.0 LICENSE and a README attributing PaddleOCR + `snowfluke/ppu-paddle-ocr-models`.
2. Tell the agent the base URL. Agent step: change `OCR_MODEL_REPO` / `OCR_MODEL_REVISION` (or add a non-HF base-URL form if you chose jsdelivr) in `src/ocr-model-catalogue.ts` — one place; `hfResolveUrl` is the only URL builder. Cache API eviction removes the old bytes on the next load. Records are untouched (§12 D2).

Low priority: only needed if upstream disappears or you want independence from it.

