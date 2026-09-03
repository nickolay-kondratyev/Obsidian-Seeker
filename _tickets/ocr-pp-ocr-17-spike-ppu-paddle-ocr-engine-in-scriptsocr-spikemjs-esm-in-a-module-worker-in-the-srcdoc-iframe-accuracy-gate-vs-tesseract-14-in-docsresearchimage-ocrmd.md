---
profile: higher
id: nid_4y2zlnfyt57qocu762lxdoiie_e
title: "OCR PP-OCR 1/7: spike — ppu-paddle-ocr engine in scripts/ocr-spike.mjs (+esm in a module Worker in the srcdoc iframe), accuracy gate vs tesseract, §14 in docs/research/image-ocr.md"
status: open
deps: [nid_6xykw7uso5943i7xvh53i2g2p_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_bj4oo8zwshwaw8v3efwa4nnim_e, nid_v9z9mlhqtm2dek4a83y28no57_e, nid_54wu4qecgbvwswm5ty6uuq0z9_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_jz9fvvhltomq9o9nmesc57zjb_e, nid_w2rhmbpwd634wv55m1top0n4g_e, nid_24y96qrb1q8ndmdttvwkfb653_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T23:19:31Z
status_updated_iso: 2026-09-03T23:19:31Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, perf, spike]
---

READ FIRST: the plan ticket (search `_tickets/` for "PLAN: PP-OCRv6-tiny default OCR engine") — decisions D1, D2, D3, D11 apply here. Then `docs/research/image-ocr.md` §8a, §8d, §11, §13 (the tesseract baseline you must beat and the table shapes to reproduce), `scripts/ocr-spike.mjs` in full (the harness you extend: per-(engine, fixture, scale) NDJSON in `.out/ocr-spike/results.ndjson`, `summary.json`, its `buildChildScript()` srcdoc-iframe child, `runEngine`, `summarize`), `scripts/ocr-fixtures.mjs` (generates `.out/ocr-fixtures/`, 22 fixtures with exact ground truth), `bench/harness/browser.mjs` (`resolveChromiumPath`, `BASE_CHROMIUM_ARGS`, `withBrowserPage`), and `src/ocr-iframe-runner.ts` `buildOcrChildScript()` (the iframe RPC shape the plugin runner will use; the spike child should have the same shape so ticket 2 can lift it).

## Goal
Re-run the Phase-0 harness with a SECOND engine, `ppu-paddle-ocr` (PP-OCRv6-tiny), on the same fixtures, decide the §11 adoption gate, and write `docs/research/image-ocr.md` §14 with the numbers and the constants ticket 2 reads off it.

## Facts you can rely on (verified 2026-09-03)
- Wrapper: `https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@6.4.3/web/+esm` (42 KB; imports `/npm/onnxruntime-web@1.29.0/+esm` and `/npm/ppu-ocv@4.0.0/canvas-web/+esm`; ORT wasm files default to `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/`). API (see `https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@6.4.3/web/index.d.ts` and `.../web/paddle-ocr.service.web.d.ts` and `.../README.md` for exact types): `new PaddleOcrService({ model: { detection, recognition, charactersDictionary } /* URL strings or ArrayBuffers */, recognition: { spaceRecovery, minimumConfidence }, detection: { maxSideLength }, session: { executionProviders } })`, `await service.initialize()`, `await service.recognize(bytesOrOffscreenCanvas)` → result with `text` and per-line entries carrying confidence (read the .d.ts for the field names). Exports `isWebGpuAvailable()`, `getDefaultWebExecutionProviders()`, `isWebWorker()`. No internal worker: run it INSIDE a `type: 'module'` Blob-URL Worker created by the iframe (D2) — this is what the plugin will do, so the spike must prove that exact shape (iframe → worker → `await import(<+esm url>)`).
- Models: HF `snowfluke/ppu-paddle-ocr-models` at commit `bf1d5edb0335d3262be7caf13f766ba274b4cadd`: `detection/ort/PP-OCRv6_tiny_det.ort` (1.9 MB), `recognition/ort/PP-OCRv6_tiny_rec.ort` (4.5 MB), `recognition/ppocrv6_tiny_dict.txt` (27 KB). URL form `https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/<sha>/<path>` (CORS `*`). Fetch them in the child with `fetch` → Cache API (`caches.open('seeker-ocr-models')`, keyed by URL) → pass `ArrayBuffer`s (D3), so the second run is warm.
- Container Chromium has NO real GPU (SwiftShader only): container numbers are single-thread wasm (no COOP/COEP → `numThreads` 1). That is the plugin's worst case and is fine for the accuracy gate (device-independent).
- Tesseract baseline (§13): all 18 clean fixtures 1.00 at every scale; corpus mean 0.94 @2×; median 173 ms/img wasm; per-word floor 60 / whole-image mean-conf floor 65 (0–100 scale).

## Deliverables
1. `scripts/ocr-spike.mjs`: add engine `ppu-paddle-ocr` alongside tesseract (keep tesseract runnable; add a `--engine tesseract|ppu|both` flag, default both). NDJSON rows gain: `engine`, `wrapperVersion`, `provider` (`webgpu`|`wasm`, as reported by the child — check `getDefaultWebExecutionProviders()` / the session; record what you can, and state in §14 whether this is the provider the wrapper SELECTED or one ORT proves it USED and how you read it — ticket 2 copies that exact rule into the runner, plan D11), `spaceRecovery`, `minConf`, `ms`, `accuracy` (same `wordAccuracy` as today), `meanLineConf` (0–1), `lineCount`, `chars`, `loadMs` (cold vs warm — clear the Cache API entry for the cold run or use a fresh profile dir), plus the existing heap probes before/after and after `worker.terminate()` + iframe removal.
2. Matrix per fixture: scale ∈ {1× raw bytes (let the detector size itself), 2× via the shared `planResize` rule}, `spaceRecovery` ∈ {false, true}, `minimumConfidence` ∈ {0.3, 0.5, 0.65}. Keep the run bounded (22 fixtures × 12 combos ≈ 264 recognitions; fine).
3. Gate (D1): corpus mean accuracy at the best combo ≥ 0.94 AND every clean fixture ≥ 0.95 AND the iframe→worker→`+esm` load works from jsdelivr without COOP/COEP. Record PASS/FAIL with the numbers in this ticket's resolution AND in §14.
4. `docs/research/image-ocr.md` §14 "PP-OCR spike (2026-09-xx)": tables mirroring §13 (per-scale/per-combo accuracy, conf distributions clean vs degraded, ms, load cold/warm, heap), the chosen constants for ticket 2 — resize policy (raw vs 2×), `minimumConfidence`, `spaceRecovery`, per-line floor, whole-image mean-line-conf floor, min chars (reuse 50) — and the proven load shape (exact URLs, worker type, Cache API keys, any CSP directive beyond what `src/ocr-iframe-runner.ts` documents). Also amend §11's "Host the model files on a URL this project controls" sentence: hosting is the upstream HF repo pinned to a commit sha, consistent with the embedding model (`onnx-community/...` in `src/iframe-runner.ts`); mirroring is a low-priority follow-up ticket.
5. Host WebGPU run (informational, NOT a gate): add an `--webgpu` flag that appends `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist` to the Chromium args (the flags that work on the reference Fedora/AMD host) and document in §14 a one-line "run on the host" recipe. The host run itself is the need-human ticket nid_rcz4oxooppw0u3y1el72js9l3_e (depends on this one) — do not block on it.
6. If `+esm` bundling of onnxruntime-web fails in the worker (e.g. the bundle throws on import or ORT cannot locate its wasm), try shape B: `import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort.webgpu.min.mjs')` first and a vendored copy of the 42 KB wrapper bundle with its ORT import rewired; record which shape works in §14 (D2).

## Acceptance
- `node scripts/ocr-fixtures.mjs && node scripts/ocr-spike.mjs` runs both engines to completion in the container and prints both summaries; `summary.json` includes the PP-OCR section.
- §14 written; the gate verdict + best-combo numbers are in this ticket's resolution.
- `npm run test` and `npm run typecheck` stay green (no plugin code changes in this ticket).
- Gate FAIL → this is a STRONG decision, not the agent's: create a ticket with `ticket create ... --tags ocr,decide,need-human` carrying the measured numbers vs the §13 tesseract baseline and the options (next candidate `V6_SMALL` ~30 MB / relax the gate / stay on tesseract), make tickets 2/7–7/7 depend on it (`ticket dep <impl-id> <new-id>`), and say so in the resolution. Do NOT pick a candidate yourself.
- Load shape dead end (neither `+esm` nor the vendored shape B loads in the iframe→worker) → same rule: `--tags ocr,decide,need-human` ticket with the exact errors, downstream tickets depend on it.

