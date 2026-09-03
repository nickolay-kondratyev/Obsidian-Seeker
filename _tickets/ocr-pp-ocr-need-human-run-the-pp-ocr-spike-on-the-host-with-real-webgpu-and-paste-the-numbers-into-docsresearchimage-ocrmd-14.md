---
id: nid_rcz4oxooppw0u3y1el72js9l3_e
title: "OCR PP-OCR (need-human): run the PP-OCR spike on the host with real WebGPU and paste the numbers into docs/research/image-ocr.md §14"
status: open
deps: [nid_4y2zlnfyt57qocu762lxdoiie_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_2qvzn924y0p6950siu0kfs4ej_e]
created_iso: 2026-09-03T23:25:27Z
status_updated_iso: 2026-09-03T23:25:27Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, perf, need-human]
---

Human-only step from the PLAN ticket nid_6xykw7uso5943i7xvh53i2g2p_e (D1: WebGPU speed is informational, NOT the adoption gate). The agent container has no GPU (SwiftShader only), so ms/img on WebGPU can only be measured on the host.

When: after ticket 1/7 (spike) lands the `--webgpu` flag and §14.

Steps on the host (Fedora/AMD reference machine):
1. `npm run bench:setup` once (Playwright Chromium), then `node scripts/ocr-fixtures.mjs && node scripts/ocr-spike.mjs --engine ppu --webgpu` (the flag adds `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`; exact recipe is in §14).
2. Confirm the NDJSON rows report `provider: webgpu` (not wasm — a SwiftShader/software adapter or missing flags silently fall back).
3. Paste the WebGPU ms/img median/mean and cold/warm load time into §14 next to the container wasm numbers, or hand the summary to an agent to do it.

Nothing downstream blocks on this; it only documents the desktop fast path.

