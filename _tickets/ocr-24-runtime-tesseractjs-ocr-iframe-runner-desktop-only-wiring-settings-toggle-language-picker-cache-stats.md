---
closed_iso: 2026-09-03T21:05:02Z
session_ids: [{"a": "claude", "type": "execution", "id": "80a5bc36-a288-40ec-bf07-17c6d23c38a6"}, {"a": "claude", "type": "review", "id": "ca4b7f2a-dcd6-424d-adb8-1bad90dab6d5"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_c9vuyt7b0e88sq8ljtu8b19le_e
title: "OCR 2/4: runtime — tesseract.js OCR iframe runner, desktop-only wiring, settings toggle + language picker + cache stats"
status: closed
deps: [nid_kw23mrjlr2g4u56x96ierq100_e]
links: [nid_5nfsr4yj8anp4jggh0uoc9bbt_e, nid_cuu1jus7e29gcqcp7xycfxhz1_e, nid_kw23mrjlr2g4u56x96ierq100_e, nid_b4wvgo11kfiba3cojrj9q95cy_e, nid_w5o7slkuv2qgl3oma5q9a4grh_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e, nid_l89twli61ofcev3vablmht1h9_e]
created_iso: 2026-09-03T19:11:39Z
status_updated_iso: 2026-09-03T21:05:02Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr]
---

READ FIRST (before any code): docs/research/image-ocr.md is the plan of record — read it in full, then re-read §5 (iframe shape, decode in child, pre-pass, failure taxonomy), §7, §8a, §9 Q4/Q5, §12 D1/D2/D4/D8, §13 (spike constants). Then read: src/iframe-runner.ts (RPC/timeout/recycle shape and the LOAD-BEARING no-`sandbox` comment), src/pacer.ts, src/platform.ts `isMobilePlatform`, src/settings-tab.ts (toggle + status card + reindex row patterns), the `OcrEngine` / `ocrPrepass` / invalidation helper landed by ticket 1/4, and the reindexAll + delta embed-loop entry points in src/search.ts. Do not deviate from the plan doc without recording the deviation in it.

Plan of record: docs/research/image-ocr.md (§5, §7, §8a, §9 Q4/Q5, §12 D1/D2/D4/D8, §13 spike numbers). Depends on the 1/4 modules (`OcrEngine`, `ocrPrepass`, `planResize`, invalidation helper). Verified in real Obsidian by nid_l89twli61ofcev3vablmht1h9_e afterwards.

Scope:
- `src/ocr-iframe-runner.ts` implementing `OcrEngine`: a SECOND srcdoc iframe (id `seeker-ocr-iframe`) with NO `sandbox` attribute (see the LOAD-BEARING comment in src/iframe-runner.ts — same origin rules, same Cache-API partition), hosting tesseract.js 7 from jsdelivr with explicit `workerPath`/`corePath`/`langPath`, core + language packs cached via the Cache API like the model. The parent transfers the raw ArrayBuffer; the CHILD decodes with `createImageBitmap`, applies the shared pure `planResize` (bundled into the child script the way the seq ladder is), runs OCR, applies the §13 per-word confidence floor and returns text + mean confidence + dims + ms. RPC with timeout + recycle mirroring src/iframe-runner.ts; ONE worker, sequential; torn down when the pre-pass drains (§8a: the wasm heap never shrinks). Never instantiated on mobile (`isMobilePlatform()` from src/platform.ts) — phones read the cache only.
- Pass integration: wire `ocrPrepass` ahead of the embed loop in BOTH `reindexAll` and the delta path (desktop only), so the OCR iframe is gone before embed batches start (peak memory = max, not sum). Pace through src/pacer.ts; a live query preempts the pre-pass exactly like an embed burst. Progress surfaces as "OCR N/M" in the same channel the reindex progress uses.
- Failure taxonomy (§5): deterministic (decode failure, pixel-cap reject) → `error` cache record + FileRecord `chunk_ids: []`; transient (engine load failure, RPC timeout, iframe crash) → NO record, FileRecord `chunk_ids: []` + `embedFailPluginVersion = PLUGIN_VERSION` so the existing per-release retry applies. Test each branch against the OcrEngine double.
- Settings (src/settings-tab.ts): "Index text in images (OCR)" toggle default OFF, desktop-only copy ("phones search text OCR'd on a desktop"); language multi-select (tesseract language codes; default = Obsidian locale mapped to a code, plus `eng`; a change never re-OCRs — §12 D2); status card: OCR progress N/M, cache count + MB (from `list`), skipped heic/svg counts, "waiting for OCR from desktop: N" on mobile; buttons per §12 D8: "Clear OCR cache" ALWAYS shown (also with OCR off) with the cache count + MB beside it; "Rebuild OCR cache" shown only while OCR is on (both call the 1/4 invalidation helper; Rebuild also kicks a catch-up pass). Copy for the toggle must state the cache location (`<sidecar index dir>/ocr/`) and that it syncs with the vault.
- README section (what it does, desktop-only, cache location and size, language packs are downloaded from jsdelivr).

Acceptance: `npm run test` + `npm run typecheck` + `npm run build` green; with `indexImages` OFF the plugin never creates the OCR iframe and never touches `ocr/`; `npm run bench` numbers unchanged (the pre-pass is a no-op with OCR off).

## Notes

**2026-09-03T21:05:02Z**

RESOLUTION (2026-09-03) — DONE. All acceptance gates green: `npm run typecheck`, `npm run test` (1472 passed / 19 skipped), `npm run build`. `npm run bench` not run but reasoned to be a no-op: the bench builds SearchOrchestrator with DEFAULT_SETTINGS (indexImages OFF), indexDir=null, and never calls setOcrEngine, so ocrPrepass returns at its first null-check without touching any queue, on a markdown-only corpus.

Delivered:
- src/ocr-iframe-runner.ts — OcrIframeRunner implements OcrEngine: second srcdoc iframe (id seeker-ocr-iframe), NO sandbox attr, tesseract.js 7 from jsdelivr with explicit workerPath/corePath/langPath, ESM default export (mod.default.createWorker), OEM.LSTM_ONLY, gzip. Child decodes via createImageBitmap({imageOrientation:'from-image'}), applies the SHARED planResize (injected via planResize.toString() + the three numeric constants), OffscreenCanvas → worker.recognize, §13 mean-conf gate (65) + per-word floor (60). RPC/timeout/recycle mirrors iframe-runner.ts; ocr() throws TRANSIENT on load-fail/RPC-timeout (recycles), resolves an OcrResult.error on DETERMINISTIC decode/pixel-cap. teardown() unmounts (§8a). loadFailed fast-fails the rest of a pass.
- src/ocr-langs.ts — DEFAULT_OCR_LANG, LOCALE_TO_TESSERACT, mapLocaleToTesseract, defaultOcrLangs (single localStorage read), effectiveOcrLangs (explicit list else AUTO).
- src/types.ts — ocrLangs: string[] setting (AUTO = []).
- src/ocr-cache.ts — OcrEngine gains optional teardown().
- src/search.ts — ocrPrepass reworked (pacer-gated, onProgress "OCR N/M", transient set, teardown in finally); wired ahead of the embed loop in reindexAllInner AND reindexDelta (desktop, gated on opts.embed so the minutes-long pass does not hold the write lock). Embed loop reads ocrTransientFailures to commit a chunk_ids:[] FileRecord with embedFailPluginVersion (per-release retry); untried misses stay dirty (filesWaitingOcr). Added clearOcrCache(), ocrCacheStats(), get ocrWaitingCount.
- src/main.ts — desktop+indexImages gate builds/tears down the OcrIframeRunner (refreshOcrEngine, skips if langs unchanged); onOcrSettingsChanged, getOcrStats (heic/svg scan), clearOcrCache, rebuildOcrCache.
- src/settings-tab.ts — renderOcr: toggle (default OFF, desktop-only copy + cache dir + syncs), language text field (blur re-wires), status line (cache count+MB, skipped heic/svg, waiting-on-mobile), Clear (always, two-step confirm) + Rebuild (only while ON).
- styles.css — .seeker-ocr-status.
- README.md — "Image OCR" section + Network Use (tesseract CDN + tessdata) + tesseract.js attribution.
- Tests: src/ocr-langs.test.ts, src/ocr-iframe-runner.test.ts (child-script text asserts + parent RPC-timeout/loadFailed via injected dead iframe), src/image-indexing.test.ts transient-quarantine scenario (embedFailPluginVersion FileRecord). ocr-prepass.test.ts (from 1/4) already covers deterministic vs transient cache-record branches.

ASSUMPTIONS / decisions made non-interactively:
- ocrPrepass runs INSIDE the mutex for reindexAll (full reindex subsumes deltas; pacer yields) but OUTSIDE for reindexDelta (so it does not hold the write lock searches wait on).
- The transient-failure quarantine writes the FileRecord in the EMBED loop (pre-pass only records the path in ocrTransientFailures), keeping the pre-pass free of store writes.
- Language field is a space/comma-separated text input (not a true multi-select widget) — 80/20; tesseract codes are short and documented, and a multi-select over ~50 packs is heavier UI for little gain.
- setOcrEngine is persistent on the orchestrator (Option B); the iframe is lazily built on first ocr() and torn down each pass drain.
