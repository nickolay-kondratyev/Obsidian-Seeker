---
profile: higher
id: nid_jz9fvvhltomq9o9nmesc57zjb_e
title: "OCR PP-OCR 6/7: real-Obsidian e2e — e2e/ocr.e2e.ts proves PP-OCR runs (image fixtures → sidecar record engine === 'ppu-paddle-ocr' → search hit → opens note), wired into npm run test:e2e:obsidian"
status: open
deps: [nid_09e6lv2lomzby3abne4r8sedu_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_4y2zlnfyt57qocu762lxdoiie_e, nid_bj4oo8zwshwaw8v3efwa4nnim_e, nid_v9z9mlhqtm2dek4a83y28no57_e, nid_54wu4qecgbvwswm5ty6uuq0z9_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_w2rhmbpwd634wv55m1top0n4g_e, nid_24y96qrb1q8ndmdttvwkfb653_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T23:19:32Z
status_updated_iso: 2026-09-03T23:19:32Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, e2e]
---

READ FIRST: the plan ticket (search `_tickets/` for "PLAN: PP-OCRv6-tiny default OCR engine") — D11, D12. Then `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md` (the CDP-attach mechanics), `docs/e2e-obsidian.md`, `e2e/obsidianHarness.ts` in full (`assembleVault` copies ONLY `*.md` from `CORPUS_DIR = e2e/datasets/cqadupstack-android/corpus`; persistent `.tmp/e2e/userdata` keeps the Chromium HTTP cache + Cache API; `E2E_VAULT_ID`; how the plugin folder is assembled), `e2e/search.e2e.ts` (serial pattern, `SEEKER_DOM` selectors, `plugin.runFullReindex({ skipConfirm: true })`, `REINDEX_DONE_PATTERN`, timeouts), `e2e/playwright.config.ts`, `scripts/run-e2e-obsidian.sh` (headless Linux runs with `--ozone-platform=headless --disable-gpu` → NO WebGPU in Docker; that is expected), `scripts/ocr-fixtures.mjs` (how fixtures with exact text are rendered), `src/ocr-cache.ts` (record shape: `h`, `engine`, `v`, `langs`, `model`, `ep`, `text`), `src/image-open.ts` (an image result opens its single referring note), and `src/types.ts` `sidecarIndexLocation: 'config'` → records live at `<vault>/.obsidian/plugins/seeker/index/ocr/<sha256>.json`.

## Goal
Prove in REAL Obsidian that the PP-OCR engine (not the fallback) runs end-to-end: image bytes → OCR record → searchable → opens. Runs in the container (wasm provider) and on the host (WebGPU), wired into `npm run test:e2e:obsidian` and therefore `release.sh`.

## Deliverables
1. Fixtures under `e2e/fixtures/ocr/`: two small PNGs rendered by a NEW committed script `scripts/ocr-e2e-fixtures.mjs` (reuse `scripts/ocr-fixtures.mjs`'s rendering approach — Playwright Chromium screenshot of an HTML page of known text via `resolveChromiumPath`/`BASE_CHROMIUM_ARGS` from `bench/harness/browser.mjs`; do NOT bolt a mode onto `ocr-fixtures.mjs`, whose output is git-ignored by design). Run it once, commit the PNGs (each under ~30 KB) and the script, so they are regenerable: `ocr-screenshot-light.png` and `ocr-screenshot-dark.png`, each showing 3–4 lines of distinctive prose containing a unique phrase that appears NOWHERE in the corpus (e.g. "the quokka ledger reconciles moonlit invoices"). Plus `ocr-fixtures.json` = `{ file, phrase, words[] }` per image (the ground truth the test reads), and one note `Screenshots.md` embedding both with `![[ocr-screenshot-light.png]]` / `![[ocr-screenshot-dark.png]]`.
2. `e2e/obsidianHarness.ts`: make the fixtures OPT-IN — `ObsidianHarness.launch(opts: { ocrFixtures?: boolean } = {})` → `assembleVault(opts)`; only when `ocrFixtures` is true copy every file from `e2e/fixtures/ocr/` except the JSON into the vault root (images + the embedding note). WHY opt-in (D12): `e2e/search.e2e.ts` asserts the exact `Indexed N files` count and images COUNT (verified: an image with OCR text is committed like any note; a text-free/`error` one is committed as a zero-chunk file — `src/search.ts` `imageZeroChunkCommit` — both increment `filesCommitted`), so adding fixtures to every vault would break that assertion; `search.e2e.ts` must stay byte-for-byte unchanged. (With no images the pre-pass returns on an empty queue before the runner is built, so OCR-on-by-default costs `search.e2e.ts` nothing.) Export `OCR_FIXTURES_DIR` and a `sidecarOcrDir()` helper returning `<VAULT_DIR>/.obsidian/plugins/<PLUGIN_ID>/index/ocr`.
3. `e2e/ocr.e2e.ts` (serial; its own `test.beforeAll(() => ObsidianHarness.launch({ ocrFixtures: true }))` / `afterAll(close)` exactly like `search.e2e.ts` — VERIFIED: each spec file launches its own Obsidian on a freshly assembled vault (`launch()` calls `assembleVault` + `prepareUserDataDir`), and `workers: 1` in `e2e/playwright.config.ts` serialises the files, so no index state is shared and no ordering trick is needed. No config change is needed to include the file: `testMatch: "**/*.e2e.ts"` already picks it up, and `sidecarOcrDir()` resolves to `<vault>/.obsidian/plugins/<PLUGIN_ID>/index/ocr` per `src/main.ts` `sidecarConfigDir`):
   a. OCR is ON by default: read `plugin.settings.indexImages === true` via `page.evaluate` (no settings UI clicks).
   b. Full reindex (`runFullReindex({ skipConfirm: true })`), wait for the done pattern (copy `REINDEX_DONE_PATTERN` and `test.setTimeout(10 min)` from `search.e2e.ts`; the expected file count is corpus `.md` count + 2 images + 1 note); first run downloads ~6 MB models + ORT wasm ~20 MB + the embedding model.
   c. For each fixture: compute sha256 of the PNG bytes in node, read `<sidecarOcrDir>/<sha>.json`, assert `engine === 'ppu-paddle-ocr'` (this is THE assertion: the fallback would say `tesseract.js`), `error === null`, `text` contains every word of `words[]` (case-insensitive), `model` starts with `tiny@`, and `ep` is `'webgpu'` or `'wasm'`; print `ep` in the test title/annotation. If `process.env.SEEKER_E2E_EXPECT_WEBGPU === '1'`, additionally assert `ep === 'webgpu'` (host runs only).
   d. Open the search modal (command id `${PLUGIN_ID}:search`, as `search.e2e.ts` builds it), type the phrase, expect the top rendered result title to be the image FILE name including extension (`ocr-screenshot-light.png` — `noteTitle()` in `src/search-modal.ts` strips only `.md`, verified) with the "in: Screenshots" line (`.seeker-result-in`), press Enter → the active file is `Screenshots.md` (single referrer → note opens), per `src/image-open.ts`.
   e. Negative control: no OCR record exists for a corpus `.md` (there is nothing to assert there); instead assert the `ocr/` dir contains exactly 2 records.
4. `docs/e2e-obsidian.md`: describe the OCR suite, the fixtures, the `ep` diagnostics, the host `SEEKER_E2E_EXPECT_WEBGPU=1` recipe (with the Linux Chromium flags from `docs/perf-bench.md` / the memory: `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist` via `OBSIDIAN_E2E_EXTRA_ARGS`), and the CSP note: this is the ONLY place the PP-OCR iframe/worker is exercised under Obsidian's real renderer CSP.
5. `CLAUDE.md` root: extend the `test:e2e:obsidian` line with "+ OCR proof (PP-OCR engine, image fixture)".

## Acceptance
- `npm run test:e2e:obsidian` green in the container (wasm) — paste the `ep` line and the OCR text read into the resolution.
- The host run with `SEEKER_E2E_EXPECT_WEBGPU=1` is the need-human ticket nid_2qvzn924y0p6950siu0kfs4ej_e (depends on this one); do not block on it.
- `npm run typecheck` green (root tsconfig includes `e2e/**`).

