---
closed_iso: 2026-09-03T23:19:58Z
id: nid_ybv5cljnxx9wb4ha2gbvpsbmd_e
title: 'OCR follow-up: PP-OCRv6-tiny engine (multilingual single model, WebGPU) behind
  the OcrEngine interface'
status: closed
deps: [nid_5zn22onkawouvyt69fp11hjs0_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_l89twli61ofcev3vablmht1h9_e]
links: [[nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_6xykw7uso5943i7xvh53i2g2p_e, nid_4y2zlnfyt57qocu762lxdoiie_e, nid_bj4oo8zwshwaw8v3efwa4nnim_e, nid_v9z9mlhqtm2dek4a83y28no57_e, nid_54wu4qecgbvwswm5ty6uuq0z9_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_jz9fvvhltomq9o9nmesc57zjb_e, nid_w2rhmbpwd634wv55m1top0n4g_e, nid_24y96qrb1q8ndmdttvwkfb653_e]
  nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e]
created_iso: '2026-09-03T19:11:39Z'
status_updated_iso: 2026-09-03T23:19:58Z
type: feature
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, perf]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker
---
--------------------------------------------------------------------------------
TASK: **PLAN**. Reach a shared understanding of this ticket before writing any plan.

## Interview
Treat the work as a design tree: each decision unlocks the decisions below it. Work in rounds. Each round, ask every question whose prerequisites are settled; questions that depend on an open question wait for a later round.

Split decisions into two kinds:
- **AGENT decides**: anything a fact settles, or where one option is clearly right. Find facts yourself (dispatch `Explore-cheap` for code base or environment questions; don't block the round on it). Decide, and list each decision with a one-line reason so the HUMAN can veto.
- **HUMAN decides**: true judgment calls: tradeoffs, scope, product intent, anything the AGENT would only be guessing at. Put each to the HUMAN and wait.

A question goes to the HUMAN only if it clears this bar: the answer changes the plan, AND it cannot be settled by a fact, AND the ticket, code base, or conventions don't already imply the answer. If the answer could be inferred with reasonable confidence, make the call under AGENT decides and let the HUMAN veto. Do NOT ask questions to appear thorough. Zero questions is a valid and expected outcome for a clear ticket.

## Asking
Do NOT use AskUserQuestion. Each round, overwrite `.out/current_decision.md` (git-ignored) with:
1. A concise summary of the problem and the key tradeoffs.
2. **AGENT decided**: what you settled yourself, one line each.
3. **HUMAN decides**: the numbered questions, formatted:

❓ **Q1** - **<title>**: <question, may include options>

➡️ <AGENT's recommendation>

---

Then tell the HUMAN to read the file and reply. After each reply, recompute the frontier and ask the next round. Done when nothing is left to ask and the HUMAN confirms a shared understanding.

If the first round produces no HUMAN questions, still write the file (summary plus AGENT decided), tell the HUMAN it needs only a veto pass, and proceed to Output once they confirm or after they reply with no objections. Do not manufacture questions to fill the section.

## Output
Only after that confirmation, write the detailed plan with requirements.
IF multiple tickets are needed
THEN put the high-level plan into a new ticket and `close` it,
AND create focused implementation tickets with `ticket dep <impl-id> <plan-id>`
ELSE put the plan into a new `open` ticket.
Split so each ticket fits in a 200K context window and is self contained: full relative paths from git root, key details included, since a less capable model will execute it.
Finally `close` this ticket.
IF any ticket needs a higher tier model to implement it, then set higher profile with CLI `ticket profile <id> higher`.
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
READ FIRST: docs/research/image-ocr.md in full, especially §8a/§8d, §11 (why, what changes, adoption gate), §12 D2, §13 (the tesseract.js baseline numbers to beat); then scripts/ocr-spike.mjs (the harness to re-run) and src/ocr-iframe-runner.ts (the `OcrEngine` implementation to mirror).

Plan of record: docs/research/image-ocr.md §11 (why, what changes, delivery, adoption gate). Re-run the Phase-0 harness (scripts/ocr-spike.mjs) with PP-OCRv6-tiny via ppu-paddle-ocr/web loaded in the srcdoc iframe; adopt only if accuracy ≥ tesseract.js on the same fixtures, loads from a CDN without COOP/COEP, and the wrapper is maintained or thin enough to vendor. Host model files on a URL this project controls. Existing cache records stay valid (§12 D2); the language setting becomes inert.

I am thinking to make sure this is working we will want to have real obsidian E2E tests, to make sure this model is actually running so before we get into OCR we will want to have separate ticket for real E2E obsidian test. See '/Users/nkondrat/vintrin-env/config/claude/ai_input/deep/obsidian-how-to-setup-e2e-test.md' memory for how to setup E2E test. Also I am thinking as part of this work we will want to enable OCR by default (and have an OPT OUT setting). And this `PP-OCRv6-tiny` will be the default with teseract as fallback, if we have to fallback we also want to display a warning in settings and in as the pop up toast in main obsidian.  REfer to ticket: nid_5zn22onkawouvyt69fp11hjs0_e which will have the test setup.

## Notes

**2026-09-03T22:46:37Z**

PLAN interview round 1 written to .out/current_decision.md (11 AGENT decisions, 1 HUMAN question: model hosting under project control — recommend a separate GitHub repo served via jsdelivr gh CDN). Awaiting human reply before writing plan/impl tickets. Facts gathered: ppu-paddle-ocr 6.4.3 (MIT, published 2026-08-27, one maintainer); web entry has no OpenCV, bare-imports onnxruntime-web; jsdelivr +esm bundle resolves (42 KB, pulls onnxruntime-web@1.29.0 +esm); v6 tiny models = 1.9 MB det + 4.5 MB rec + 27 KB dict, Apache-2.0, ModelPathOptions accept ArrayBuffer (so plugin fetch + Cache API); wrapper has NO internal worker (must run in a module Worker in the iframe or it blocks the renderer); WebGPU auto with silent wasm fallback, COOP/COEP only affects wasm threads; PP-OCR conf is 0-1 per line with spaceRecovery off by default (spike must re-derive thresholds); OCR has never shipped (tag 1.1.10 lacks it) so default-on can be a plain rev-12 migration; e2e harness assembles md-only vaults, no image test yet.

**2026-09-03T22:52:06Z**

Round 1 Q1 corrected after human pointed out the embedding model already loads from a third-party HF org (onnx-community, revision-pinned). Revised recommendation: use upstream HF snowfluke/ppu-paddle-ocr-models pinned to commit sha bf1d5edb0335d3262be7caf13f766ba274b4cadd (verified CORS *), mirror later via a low-priority need-human ticket; amend docs/research/image-ocr.md §11 accordingly.

**2026-09-03T22:58:59Z**

Round 1 resolved: Q1 = upstream HF (snowfluke/ppu-paddle-ocr-models, sha-pinned). Human added scope: OCR becomes its own settings section; OCR model overridable (HF repo) under a collapsed 'Advanced image OCR settings' disclosure. Round 2 written to .out/current_decision.md: 6 more AGENT decisions (section layout, preset Tiny/Small/Medium/Custom + 5 custom fields, OcrModelOverride shape, validate-then-save mirroring model-validate.ts, D2 no re-OCR on switch, fallback still applies under override); zero HUMAN questions — awaiting veto pass before writing plan/impl tickets.

## Resolution (2026-09-03)
PLAN interview completed in two rounds (`.out/current_decision.md`); human ratified with amendments:
- Q1 model hosting → upstream Hugging Face `snowfluke/ppu-paddle-ocr-models` pinned to commit `bf1d5edb0335d3262be7caf13f766ba274b4cadd` (the embedding model already loads from a third-party HF org the same way); mirroring under the author's account is a low-priority need-human follow-up. §11's "host it yourself" line is amended by ticket 1/7.
- Human amendments: the new "Image OCR" settings section goes directly AFTER "Model & performance" (model first, OCR second); the advanced disclosure is collapsed on every open; the persisted OCR model setting is EXPLICIT even for the default tiny (`{ kind: 'preset', preset: 'tiny' }`) and records stamp the model used; switching the model never drops or re-OCRs existing records (still valid, maybe not as good) — the easy re-OCR trigger is the existing Rebuild button in the same section; a failing (or overridden-and-broken) fast engine falls back to Tesseract with a warning.
- Agent decisions (veto passed): spike-first with a concrete accuracy gate; `+esm` bundle inside a module Worker inside the OCR srcdoc iframe (the wrapper has no internal worker; main-thread wasm would freeze the renderer); plugin-side model fetch into the Cache API; `FallbackOcrEngine` whose identity getters delegate to the engine that produced the last result; per-device (localStorage) fallback reason + one toast per pass; OCR on by default via rev-12 migration (OCR never shipped: tag 1.1.10 has no OCR code) with a one-time notice; `ocrLangs` becomes "Fallback OCR languages (Tesseract)" inside the disclosure; real-Obsidian e2e asserts the sidecar record's `engine === 'ppu-paddle-ocr'` and logs the execution provider (`ep`), env-gated WebGPU assertion for host runs.

Tickets created:
- Plan (closed): nid_6xykw7uso5943i7xvh53i2g2p_e — decisions D1–D13 + facts
- 1/7 spike + gate + §14 (profile higher): nid_4y2zlnfyt57qocu762lxdoiie_e
- 2/7 PaddleOcrIframeRunner + catalogue + provenance fields (higher): nid_bj4oo8zwshwaw8v3efwa4nnim_e deps 1/7
- 3/7 FallbackOcrEngine + warning state + main wiring: nid_v9z9mlhqtm2dek4a83y28no57_e deps 2/7
- 4/7 OCR on by default + Image OCR section: nid_54wu4qecgbvwswm5ty6uuq0z9_e deps 3/7
- 5/7 model override + validate-then-save (higher): nid_09e6lv2lomzby3abne4r8sedu_e deps 4/7
- 6/7 real-Obsidian e2e proof: nid_jz9fvvhltomq9o9nmesc57zjb_e deps 5/7
- 7/7 docs + change_log: nid_w2rhmbpwd634wv55m1top0n4g_e deps 6/7
- need-human follow-up, mirror model files: nid_24y96qrb1q8ndmdttvwkfb653_e deps 2/7
- need-human, host WebGPU spike run → §14 numbers: nid_rcz4oxooppw0u3y1el72js9l3_e deps 1/7
- need-human, host e2e run with SEEKER_E2E_EXPECT_WEBGPU=1: nid_2qvzn924y0p6950siu0kfs4ej_e deps 6/7
