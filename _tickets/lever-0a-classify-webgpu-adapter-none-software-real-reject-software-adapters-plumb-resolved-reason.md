---
session_ids: [{"a": "claude", "type": "execution", "id": "aebda069-066c-4d02-b794-1b65e35ce044"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_yketo7yrdmkfdhbvywrzgux74_e
title: "Lever #0a: classify WebGPU adapter (none / software / real), reject software adapters, plumb resolved reason"
status: in_progress
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e]
links: []
created_iso: 2026-09-02T22:54:53Z
status_updated_iso: 2026-09-02T23:16:17Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, linux, lever0]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Ships first; no bench dependency.

## Why
On the reference host the plugin silently ran on WASM while the user had Force WebGPU on. Reference host (verified 2026-09-02): Fedora Linux, AMD Ryzen AI MAX+ 395 w/ Radeon 8060S iGPU (32 threads), Obsidian 1.13.7 Flatpak, Electron 43.3.0 / Chrome 150. Without flags `navigator.gpu` exists but `requestAdapter()` returns null -> plugin silently resolved to WASM while the setting said Force WebGPU. Verified working flags: `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`. Flatpak persists flags in `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf` (one flag per line).
Today `src/iframe-runner.ts` (~lines 795-880, inside the child script built by `buildChildScript`) does: `if (!navigator.gpu) webgpuError='navigator.gpu not present'; else adapter = await navigator.gpu.requestAdapter(); if (!adapter) webgpuError='requestAdapter returned null'; else tryWebgpu(...)`. It never checks whether the adapter is a SOFTWARE adapter (SwiftShader / lavapipe), which would be slower than WASM while reporting `webgpu`. Observed in a container Chromium 151 with `--enable-unsafe-webgpu`: adapter with `info.vendor === 'google'`, `info.description === ''`, and NO `isFallbackAdapter` property on the adapter object (newer Chromium moved it to `adapter.info.isFallbackAdapter`).

## What to build
1. A pure, unit-testable classifier (new module, e.g. `src/gpu-adapter.ts`): `classifyAdapter(input: { present: boolean; isFallbackAdapter?: boolean | null; infoIsFallback?: boolean | null; vendor?: string; architecture?: string; description?: string }) -> 'none' | 'software' | 'real'`. Software if any fallback flag is true OR vendor/description (case-insensitive) matches swiftshader | llvmpipe | lavapipe | vendor === 'google' with empty description. Keep the regex/list as named constants with a WHY comment. Unit tests: one assert per case (none, software via flag on adapter, via flag on info, via description 'llvmpipe', real AMD `vendor:'amd'`, real Apple, real NVIDIA).
2. In the iframe child script (`src/iframe-runner.ts` child block; no backticks allowed inside the template literal — see the existing comment near `profileRuntime`), after `requestAdapter()`: gather the fields above (the child runs the classifier logic inline or via a shared string-inlined helper — follow how `WARMUP_BATCH_SIZES` is inlined at ~line 473), and when classification is `software`: do NOT call `tryWebgpu`; set `webgpuError = 'webgpu-fallback-rejected: <vendor>/<description>'` and take the WASM path. Add the adapter summary (`vendor`, `architecture`, `description`, classification) to the load result already returned to the parent (`entry.actualDevice` is consumed in `src/main.ts` ~line 1041-1046).
3. Plumb a `resolvedBackend` record into `src/platform.ts` next to `recordActiveBackend` (~line 70): persist `{ device: 'webgpu'|'wasm', requested: 'auto'|'wasm'|'webgpu', reason: string|null, adapter: {vendor, architecture, description}|null }` in localStorage (per-device, never synced — same convention as `seek-active-backend`; keep that key working). Expose `getResolvedBackend()` for the settings tab / notices (ticket #0b).
4. Diagnostic-only slow-warmup signal. NOTE the existing warmup loop (~lines 833-858) times only the WHOLE grid (`warmupMs`), not individual passes, and is skipped entirely on a fingerprint hit (`skipWarmup`), so it cannot supply this signal. Add a dedicated probe that runs AFTER the warmup block (and also when warmup was skipped): 3 passes of shape (batch 1, seq 128) through `pipeline(...)` with the same `padding: 'max_length'` options, take the median (the median absorbs a one-off shader compile on a cold Dawn cache). If it exceeds a named constant (start at 250 ms; comment that it is a heuristic), set `resolvedBackend.reason = 'webgpu-slow-warmup'` WITHOUT changing device, and report the probe median in the load entry (`webgpuProbeMs`). Cost: 3 tiny dispatches per WebGPU load.
5. Log schema (`src/types.ts` load entry): add the adapter summary + reason fields; bump nothing persisted in the index (this is log-only).

## Files
- `src/iframe-runner.ts` (child script ~795-880, load-result shape ~130-260, WARMUP inlining ~473)
- `src/platform.ts` (~30-75 backend keys; `resolveDevice` ~92-98)
- `src/main.ts` (~1030-1050 load + `recordActiveBackend`)
- `src/types.ts` (load entry type), `src/gpu-adapter.ts` (+ `.test.ts`, new)
- Existing tests to keep green: `src/iframe-runner.test.ts`, `src/platform.test.ts`.

## Constraints
- No behavior change for real-GPU users or mobile beyond the extra fields.
- Popout-window convention: `window.setTimeout` / `activeWindow` only.
- `npm run test` and `npm run typecheck` green.

## Acceptance Criteria

classifyAdapter unit tests cover none/software/real; software adapter -> WASM with reason 'webgpu-fallback-rejected' visible in the load log entry; getResolvedBackend() returns requested/device/reason/adapter after load; no change to resolveDevice() ladder.

