---
closed_iso: 2026-09-03T19:56:19Z
session_ids: [{"a": "claude", "type": "execution", "id": "8497a2d2-9f10-4bcb-8dfe-220f43193cf6"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_cuu1jus7e29gcqcp7xycfxhz1_e
title: "OCR 0/4: Phase-0 spike — tesseract.js 7 bench on generated screenshots (accuracy, ms/img, heap, iframe CSP)"
status: closed
deps: []
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_c9vuyt7b0e88sq8ljtu8b19le_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e, nid_l89twli61ofcev3vablmht1h9_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T19:56:19Z
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

---

## Resolution (2026-09-03) — DONE

Built and ran the bench-first spike end-to-end in this container. All three
deliverables + the acceptance criteria are met; §13 "Phase-0 results" is written
into `docs/research/image-ocr.md` and carries every constant ticket 1/4 needs.

**What was built (all committed; fixtures/results are NOT — `.out/` is git-ignored):**
- `scripts/ocr-fixtures.mjs` — Playwright renderer of KNOWN text → screenshots +
  exact ground-truth `.txt` + `index.json` into `.out/ocr-fixtures/`. 22 fixtures:
  font-size sweep 8–24 px, sans/serif/mono, light/dark, DPR 1 and 2, code/table/
  chat, JPEG-q55/q20, blurred variants; the last 4 are deliberately degraded to
  anchor the threshold low end (generated renders are otherwise too clean — D7).
- `scripts/ocr-spike.mjs` — loads tesseract.js **7.0.0** from jsdelivr inside a
  srcdoc iframe with **NO `sandbox`** (real http origin via the bench harness,
  `bench/harness/browser.mjs`), explicit `workerPath`/`corePath`/`langPath`,
  Blob worker + remote `importScripts` + wasm. Child receives the image as a
  transferred `ArrayBuffer`, decodes with `createImageBitmap` (resize during
  decode) → `OffscreenCanvas` → `recognize`. Records ms/img, word accuracy vs
  ground truth, per-word + whole-image confidence, main-isolate heap
  (CDP `Performance.getMetrics`) before/after/after-terminate, and the eng+deu
  language sweep. NDJSON + `summary.json` → `.out/ocr-spike/`.
- `scripts/ocr-spike.test.mjs` — vitest for the pure accuracy math
  (`words`/`wordEditDistance`/`wordAccuracy`/`stats`); 13 tests, green. Full
  suite still green (1391 passed).

**Run it:** `node scripts/ocr-fixtures.mjs && node scripts/ocr-spike.mjs`
(first run downloads core wasm + lang data; cached in `.tmp/ocr-spike-cache/`).

**Headline numbers (dev container, Chromium 151, wasm SIMD, no GPU):**
- Clean fixtures: 100 % accuracy at every scale (D7 upper bound). Upscaling
  rescues small/degraded text (8 px 52 %@1× → 100 %@2×); gain plateaus at ~2×,
  3× costs +25 % ms for nothing (occasionally regresses JPEG). ms/img median:
  105 / 173 / 216 at 1×/2×/3×.
- Chosen constants → §13 table: resize long-edge window **[2000,3000] px**
  (~2× upscale), pixel cap **25 MP** (carried from D4, not exercised), per-word
  conf floor **60**, whole-image min mean-conf **65**, min chars **50**
  (confidences are 0–100, not 0–1).
- Worker/CSP shape recorded (ESM has only a DEFAULT export = the Tesseract
  namespace; core wasm 4.69 MB, eng 10.9 MB / deu 7.1 MB lang packs; needs
  `wasm-unsafe-eval` + `blob:` worker + jsdelivr/tessdata `connect-src`).
- Second language pack: warm load ~140 ms, +5 ms/img median, ~0 accuracy delta →
  language multi-select is cheap at runtime (cost is download + memory per pack).

**Honest limitations (see §13):**
- Heap: `JSHeapUsedSize` is the MAIN-isolate heap (stayed flat 1.6→3.5 MB); the
  ~160 MB wasm working set lives in the Blob WORKER thread and is NOT counted by
  that metric (nor `performance.memory`). Could not byte-quantify "heap never
  shrinks"; the teardown-after-drain conclusion is sound by construction (only
  `worker.terminate()` reclaims the worker's `WebAssembly.Memory`) and confirmed
  operationally (clean terminate + rebuild). A process-RSS probe is a nice-to-have.
- The 25 MP pixel cap was not hit by any fixture → follow-up should confirm the
  decode/reject path on a real >25 MP image.
- Ran under the permissive container origin, NOT Obsidian's real CSP — that is
  the Phase-2 verify ticket nid_l89twli61ofcev3vablmht1h9_e.
