---
id: nid_2qvzn924y0p6950siu0kfs4ej_e
title: "OCR PP-OCR (need-human): run e2e/ocr.e2e.ts on the host with SEEKER_E2E_EXPECT_WEBGPU=1 (real Obsidian + WebGPU) and record the result"
status: open
deps: [nid_jz9fvvhltomq9o9nmesc57zjb_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_rcz4oxooppw0u3y1el72js9l3_e]
created_iso: 2026-09-03T23:25:27Z
status_updated_iso: 2026-09-03T23:25:27Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, e2e, need-human]
---

Human-only step from the PLAN ticket nid_6xykw7uso5943i7xvh53i2g2p_e (D12). The container runs the OCR e2e headless with `--disable-gpu`, so it proves PP-OCR on the wasm provider only; the WebGPU provider under real Obsidian can only be proven on the host.

When: after ticket 6/7 (e2e/ocr.e2e.ts) lands.

Steps on the host:
1. `OBSIDIAN_E2E_EXTRA_ARGS="--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist" SEEKER_E2E_EXPECT_WEBGPU=1 npm run test:e2e:obsidian -- ocr.e2e.ts` (macOS: no extra args needed; `docs/e2e-obsidian.md` has the recipe).
2. Expected: the suite passes and the annotated `ep` is `webgpu`. If it reports `wasm`, WebGPU was not available to Obsidian (flags / adapter) — record that here; it is not a plugin bug by itself (the plugin falls back silently by design).
3. Add the outcome as a note on this ticket and close it.

