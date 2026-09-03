---
profile: higher
id: nid_v9z9mlhqtm2dek4a83y28no57_e
title: "OCR PP-OCR 3/7: FallbackOcrEngine (PP-OCR primary → Tesseract), per-pass fallback Notice + per-device persisted reason, main.ts refreshOcrEngine composition"
status: open
deps: [nid_bj4oo8zwshwaw8v3efwa4nnim_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_4y2zlnfyt57qocu762lxdoiie_e, nid_bj4oo8zwshwaw8v3efwa4nnim_e, nid_54wu4qecgbvwswm5ty6uuq0z9_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_jz9fvvhltomq9o9nmesc57zjb_e, nid_w2rhmbpwd634wv55m1top0n4g_e, nid_24y96qrb1q8ndmdttvwkfb653_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T23:19:31Z
status_updated_iso: 2026-09-03T23:19:31Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr]
---

READ FIRST: the plan ticket (search `_tickets/` for "PLAN: PP-OCRv6-tiny default OCR engine") — D4, D5, D11. Then `src/ocr-cache.ts` (`OcrEngine` contract incl. the new `model` field), `src/ocr-paddle-runner.ts` (ticket 2's primary), `src/ocr-iframe-runner.ts` (the tesseract secondary; note its TRANSIENT-throw vs DETERMINISTIC-result split and `loadFailed` fast-fail), `src/search.ts` `ocrPrepass` (the one call site: it stamps `engine.engine/version/langs/model` AFTER each `ocr()` resolves and calls `engine.teardown?.()` at drain), `src/main.ts` `refreshOcrEngine` / `onOcrSettingsChanged` / `ocrEngine` field, `src/platform.ts` (`getBackendOverride`/`setBackendOverride`/`isWebgpuDemoted` — the per-device localStorage pattern to copy for the fallback reason), `src/ocr-langs.ts` `effectiveOcrLangs`, `src/test-harness/scenario.ts` `fakeOcrEngine`.

## Goal
Compose PP-OCR (primary) over tesseract (secondary) behind ONE `OcrEngine`, surface a fallback as a per-pass toast + a per-device persisted warning, and wire it into `src/main.ts`. Settings UI for the warning row is ticket 4; this ticket exposes the state it renders.

## Deliverables
1. `src/ocr-fallback-engine.ts` — `export class FallbackOcrEngine implements OcrEngine`, constructor `(primary: OcrEngine, secondary: OcrEngine, hooks: { onFallback(reason: string): void })` (ONE hook; clearing the warning is the paddle runner's `onReady`, wired in main.ts — plan §Shared conventions):
   - `ocr(bytes)`: while not switched → `primary.ocr(bytes)`; on a THROW (transient: load failure, RPC timeout, crash) → set `switched = true`, call `onFallback(<plain-language reason from the error message>)` ONCE, then serve this and every later image of the pass from `secondary.ocr(bytes)`. A resolved result with `error` set (decode/pixel-cap) is returned as-is — never a switch (D4). A secondary throw propagates (the prepass already handles it).
   - Identity getters `engine`, `version`, `langs`, `model` delegate to the engine that produced the LAST result (initially primary) — the prepass reads them after `await engine.ocr()`, so each record gets the right provenance with no prepass change. Add a unit test proving a record written after the switch carries tesseract's identity and one before carries PP-OCR's.
   - `teardown()`: tear BOTH down (each is idempotent), reset `switched` so the next pass tries the primary again.
   - `src/ocr-fallback-engine.test.ts` with fake engines: first-image load failure → all images via secondary + exactly one `onFallback`; mid-pass timeout → rest via secondary; deterministic error → no switch; teardown resets; identity delegation.
2. Per-device fallback state in `src/platform.ts` (or a sibling `src/ocr-fallback-state.ts` if platform.ts is getting long): `getOcrFallbackReason(): string | null`, `setOcrFallbackReason(reason)`, `clearOcrFallbackReason()` on `localStorage` key `seeker-ocr-fallback-reason` (NOT `data.json`: settings sync across devices and a warning about this desktop's engine must not appear on another device — D5). Unit-test with a stub storage like the existing platform tests.
3. `src/main.ts`:
   - `refreshOcrEngine()`: when OCR wanted on desktop, build `new FallbackOcrEngine(new PaddleOcrIframeRunner(spec, { onReady: () => { clearOcrFallbackReason(); /* re-render the settings tab if open */ } }), new OcrIframeRunner(effectiveOcrLangs(this.settings)), { onFallback: reason => { setOcrFallbackReason(reason); new Notice(`Seeker: fast OCR engine unavailable (${reason}). Using Tesseract for this pass.`, 8000); } })` where `spec = resolveOcrModel(ocrModelSetting(this.settings))`. Right after constructing the live runner, fire-and-forget `void evictStaleOcrModelCaches([the three hfResolveUrl(...) of spec]).catch(log)` (ticket 2, D3) so a catalogue bump or a model switch reclaims the old bytes. Replace the "unchanged" check (`cur.langs.join(',')`) with an identity key `${ocrModelIdentity(spec)}|${langs.join(',')}` kept on the plugin next to `ocrEngine`, so a model or language change re-wires and nothing else does. Until ticket 5 lands, `this.settings.ocrModel` does not exist yet: `ocrModelSetting(settings)` is a tiny accessor in `src/main.ts` that returns `DEFAULT_OCR_MODEL` from `src/ocr-model-catalogue.ts`; ticket 5 points it at the persisted key.
   - `retryPrimaryOcrEngine()` for the settings "Retry fast engine" button (ticket 4): `clearOcrFallbackReason()`, then tear down AND null the current engine (`void cur.teardown?.(); this.ocrEngine = null;` — nulling without teardown would leak the iframes), then `refreshOcrEngine()` (the identity key is unchanged, so the null is what forces a rebuild), then the same catch-up kick `onOcrSettingsChanged()` does (`catchUpPending = true; runCatchUp()`).
   - Expose `getOcrEngineStatus(): { fallbackReason: string | null; primary: 'ppu-paddle-ocr'; model: string }` for the settings tab.
4. Keep the existing `src/ocr-prepass.test.ts` scenarios green; add one scenario through `src/test-harness/scenario.ts` where the engine is a `FallbackOcrEngine` over two fakes and the primary throws on load: records exist, stamped with the secondary's identity, and `onFallback` fired once.

## Acceptance
- `npm run typecheck`, `npm run test`, `npm run build` green.
- Manual: in a dev vault, point `PPU_ESM_URL` at a bogus URL (temporarily) → next pass shows ONE toast, OCR still completes via tesseract, records show `engine: "tesseract.js"`, `localStorage['seeker-ocr-fallback-reason']` is set; restore the URL → next pass clears it. Record the outcome in the resolution.

