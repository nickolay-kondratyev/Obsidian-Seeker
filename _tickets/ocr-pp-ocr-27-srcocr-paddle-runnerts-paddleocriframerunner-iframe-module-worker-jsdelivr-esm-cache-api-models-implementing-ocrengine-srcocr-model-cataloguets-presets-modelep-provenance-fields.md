---
profile: higher
id: nid_bj4oo8zwshwaw8v3efwa4nnim_e
title: "OCR PP-OCR 2/7: src/ocr-paddle-runner.ts PaddleOcrIframeRunner (iframe + module Worker + jsdelivr +esm + Cache API models) implementing OcrEngine, src/ocr-model-catalogue.ts presets, model/ep provenance fields"
status: open
deps: [nid_4y2zlnfyt57qocu762lxdoiie_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_4y2zlnfyt57qocu762lxdoiie_e, nid_v9z9mlhqtm2dek4a83y28no57_e, nid_54wu4qecgbvwswm5ty6uuq0z9_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_jz9fvvhltomq9o9nmesc57zjb_e, nid_w2rhmbpwd634wv55m1top0n4g_e, nid_24y96qrb1q8ndmdttvwkfb653_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T23:19:31Z
status_updated_iso: 2026-09-03T23:19:31Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, perf]
---

READ FIRST: the plan ticket (search `_tickets/` for "PLAN: PP-OCRv6-tiny default OCR engine") — D2, D3, D11, D13. Then `docs/research/image-ocr.md` §14 (written by the spike ticket: the proven load shape, the constants, any extra CSP directive) and §5; `src/ocr-iframe-runner.ts` in full (the runner you mirror: iframe build, RPC/timeout/recycle, `buildOcrChildScript()` exported for text-assert tests, TRANSIENT throw vs DETERMINISTIC `error` result, no `sandbox` attribute — LOAD-BEARING); `src/ocr-iframe-runner.test.ts` (the test pattern); `src/ocr-cache.ts` (`OcrEngine`, `OcrResult`, `OcrRecord`); `src/image-file.ts` (`planResize`, `PIXEL_CAP`, resize constants); `scripts/ocr-spike.mjs` (the spike's child/worker code to lift); `src/model-candidate.ts` (`isValidHfSlug`, `revisionInfoUrl`, `parseRevisionSha` — reusable HF helpers).

## Goal
A production `OcrEngine` for PP-OCRv6 via `ppu-paddle-ocr/web`, plus the model catalogue module. NOT wired into `src/main.ts` here (ticket 3 does that) — but it must build, typecheck and be constructible.

## Deliverables
1. `src/ocr-model-catalogue.ts` (pure, unit-tested in `src/ocr-model-catalogue.test.ts`):
   - `OCR_MODEL_REPO = 'snowfluke/ppu-paddle-ocr-models'`, `OCR_MODEL_REVISION = 'bf1d5edb0335d3262be7caf13f766ba274b4cadd'`.
   - `OcrModelPreset = 'tiny' | 'small' | 'medium'` and `OCR_MODEL_PRESETS: Record<OcrModelPreset, { detection, recognition, dictionary, label, approxMB }>` with paths `detection/ort/PP-OCRv6_<tier>_det.ort`, `recognition/ort/PP-OCRv6_<tier>_rec.ort`, dictionary `recognition/ppocrv6_tiny_dict.txt` for tiny and `recognition/ppocrv6_dict.txt` for small/medium (approx sizes 6 / 30 / 139 MB).
   - `OcrModelSetting = { kind: 'preset'; preset: OcrModelPreset } | { kind: 'custom'; repo: string; revision: string; detection: string; recognition: string; dictionary: string }` and `DEFAULT_OCR_MODEL: OcrModelSetting = { kind: 'preset', preset: 'tiny' }` (D8). BOTH live HERE (this module is a leaf: it must import nothing from `src/types.ts`); ticket 5 adds the persisted field to `src/types.ts` by importing the type from here (plan §Shared conventions).
   - `resolveOcrModel(setting): OcrModelSpec` → `{ repo, revision, detection, recognition, dictionary, label }` (label = preset name or 'custom').
   - `hfResolveUrl(repo, revision, path)` → `https://huggingface.co/<repo>/resolve/<revision>/<path>`.
   - `ocrModelIdentity(spec)` → `<label>@<repo>@<sha7>` (stamped on records, D11).
   - `presetMatching(spec): OcrModelPreset | null` (so a custom spec equal to a preset displays as that preset).
   - `shouldEvictOcrModelCacheUrl(url: string, keepUrls: readonly string[]): boolean` — pure predicate (true when `url` is NOT one of the three active file URLs), unit-tested. Mirrors `src/model-registry.ts` `shouldEvictCacheUrl`.
2. `src/ocr-cache.ts`: `OcrEngine` gains `readonly model: string | null`; `OcrRecord` gains `model?: string`; `OcrResult` gains `ep?: string` (execution provider actually used). Update `src/ocr-iframe-runner.ts` (`model = null`) and `src/test-harness/scenario.ts` `fakeOcrEngine` (`model: null`). `src/search.ts` `ocrPrepass` stamps `model: engine.model ?? undefined` — keep the record JSON free of `"model": null` (omit when null) so tesseract records look exactly as today; add an assertion in `src/ocr-prepass.test.ts`.
3. `src/ocr-paddle-runner.ts` — `export class PaddleOcrIframeRunner implements OcrEngine` (`engine = 'ppu-paddle-ocr'`, `version = PPU_PADDLE_OCR_VERSION` ('6.4.3'), `langs = ['multi']`, `model = ocrModelIdentity(spec)`), constructor `(spec: OcrModelSpec, opts?: { onReady?: (info: { ep: string }) => void; iframeId?: string /* default 'seeker-ocr-paddle-iframe'; ticket 5's throwaway validation runner passes 'seeker-ocr-paddle-probe-iframe' so it never collides with the live runner's iframe */ })`:
   - Iframe id `seeker-ocr-paddle-iframe`, anchored to `window.document` like the tesseract runner, `seeker-hidden` class, NO `sandbox` attribute (copy the LOAD-BEARING comment). The child script creates a Blob-URL `type: 'module'` Worker; the worker does `await import(PPU_ESM_URL)` (the §14 proven URL), fetches the three model files through the Cache API `seeker-ocr-models` keyed by `hfResolveUrl(...)` (D3: cache-then-fetch ONLY — the worker NEVER deletes cache entries; eviction is parent-side, see deliverable 3b), builds `PaddleOcrService` with the §14 constants (`spaceRecovery`, `minimumConfidence`, resize policy — reuse `planResize` only if §14 says to upscale; otherwise pass raw bytes but STILL enforce `PIXEL_CAP` via `createImageBitmap` dims → deterministic `error: 'pixel-cap'`), `initialize()`, reports `{ ep }` (webgpu|wasm) back — `ep` is the provider the wrapper SELECTED (`isWebGpuAvailable()` → 'webgpu' else 'wasm') unless §14 documents a signal for the provider actually USED; say which in the `OcrResult.ep` comment (D11); per image: decode failure → `error: 'decode'`; whole-image mean line-confidence below the §14 floor → `text: ''`; else lines joined with '\n' filtered by the §14 per-line floor; result carries `conf` (mean line conf ×100 to keep the record's 0–100 convention — document this in the `OcrResult.conf` comment), `w`, `hpx`, `ms`, `pre`, `ep`.
   - RPC: iframe relays `load` / `ocr` (transfer the ArrayBuffer through to the worker) / results; timeouts: reuse the tesseract runner's `READY_TIMEOUT_MS` / `LOAD_RPC_TIMEOUT_MS` / `OCR_RPC_TIMEOUT_MS` values (export them from a tiny shared `src/ocr-runner-shared.ts` ONLY if you also extract the iframe build/RPC/pending-map code — D13: extract when the duplication would exceed ~100 lines, otherwise duplicate with a comment naming the twin).
   - TRANSIENT (load failure, RPC timeout, worker/iframe crash) → throw; the runner fast-fails the rest of the pass after a load failure and recycles after a per-image timeout, exactly like the tesseract runner. `teardown()` = `worker.terminate()` + iframe removal + reset.
   - 3b. `export const OCR_MODEL_CACHE_NAME = 'seeker-ocr-models'` and `export async function evictStaleOcrModelCaches(keepUrls: readonly string[]): Promise<{ seen: number; deleted: number }>` in this file: parent-side, best-effort (benign when `caches` is absent), `caches.open(OCR_MODEL_CACHE_NAME)` → `keys()` → delete every request for which `shouldEvictOcrModelCacheUrl(req.url, keepUrls)` is true. The srcdoc iframe has NO `sandbox`, so it shares the parent origin and the parent sees the same cache (same fact `src/model-registry.ts` relies on). Ticket 3 calls it from `refreshOcrEngine`; ticket 5's throwaway runner never triggers it.
   - `export function buildPaddleChildScript(spec, constants): string` (and the worker source it embeds) so `src/ocr-paddle-runner.test.ts` can assert on the emitted text: the `+esm` URL, the three model URLs, the Cache API name, the worker `type: 'module'`, the constants, and that no backtick/`${` leaks (same discipline as `buildOcrChildScript`).
4. `esbuild.config.mjs` / CSP: if §14 recorded an extra CSP directive, add it where the tesseract runner's requirements are documented (file header comment), not in code (the srcdoc iframe inherits the permissive CSP).

## Acceptance
- `npm run typecheck`, `npm run test`, `npm run build` green; new tests for the catalogue (resolve/identity/presetMatching/url) and the child-script text.
- A short manual smoke recipe in the runner's file header (open devtools, construct the runner from the console, `ocr(bytes)` on a pasted PNG) — the real proof is ticket 6.

