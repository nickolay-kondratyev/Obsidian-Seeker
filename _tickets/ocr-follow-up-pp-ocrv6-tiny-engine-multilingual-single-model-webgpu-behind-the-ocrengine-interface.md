---
id: nid_ybv5cljnxx9wb4ha2gbvpsbmd_e
title: 'OCR follow-up: PP-OCRv6-tiny engine (multilingual single model, WebGPU) behind
  the OcrEngine interface'
status: in_progress
deps: [nid_5zn22onkawouvyt69fp11hjs0_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_l89twli61ofcev3vablmht1h9_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e,
  nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e]
created_iso: '2026-09-03T19:11:39Z'
status_updated_iso: '2026-09-03T22:40:22Z'
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
