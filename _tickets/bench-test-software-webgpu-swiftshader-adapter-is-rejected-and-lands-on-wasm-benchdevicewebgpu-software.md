---
id: nid_ao3yiodwpuanpxzcuyppja2w0_e
title: "Bench test: software-WebGPU (SwiftShader) adapter is rejected and lands on WASM (BENCH_DEVICE=webgpu-software)"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_yketo7yrdmkfdhbvywrzgux74_e, nid_pt77674z2iel2w8rmdga3bvkb_e]
links: []
created_iso: 2026-09-02T22:54:55Z
status_updated_iso: 2026-09-02T22:54:55Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, webgpu, lever0, test]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on lever #0a (classifier + rejection) and the bench harness (browser-mode plumbing).

## What
A browser-mode test (gated like the bench, `BENCH=1`) that launches with `--enable-unsafe-webgpu` only (container Chromium 151 then returns a SwiftShader adapter: `info.vendor === 'google'`, empty description, no `isFallbackAdapter` on the adapter object), loads the real `LocalEmbedder` with device `'auto'`, and asserts: resolved device is `wasm`, `getResolvedBackend().reason` starts with `webgpu-fallback-rejected`, and the adapter summary records vendor `google`. Second test: with NO WebGPU flags, `requestAdapter()` is null and reason is `requestAdapter returned null`.

## Why
Turns lever #0a's detection from "trust me" into an executable check on the exact software-adapter shape seen in the wild, reproducible in the container without a GPU.

## Files
- `bench/harness/webgpu-software.test.ts` (new), reuse harness launch config from the bench harness ticket; `src/gpu-adapter.ts` + `src/platform.ts` from lever #0a.

## Acceptance Criteria

Both tests pass in the container under BENCH=1; skipped under plain npm run test.

