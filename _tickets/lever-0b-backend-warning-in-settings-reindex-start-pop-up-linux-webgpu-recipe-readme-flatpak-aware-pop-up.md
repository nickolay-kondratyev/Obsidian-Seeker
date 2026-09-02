---
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_9onhu2309zfy32w37xtmz8a0p_e
title: "Lever #0b: backend WARNING in settings + reindex-start pop-up, Linux WebGPU recipe (README + Flatpak-aware pop-up)"
status: in_progress
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e, nid_yketo7yrdmkfdhbvywrzgux74_e]
links: []
created_iso: 2026-09-02T22:54:54Z
status_updated_iso: 2026-09-02T23:23:32Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, linux, lever0, ux, docs]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. Depends on lever #0a (`getResolvedBackend()` in `src/platform.ts`).

## Policy (human-approved)
- Never break search: WASM fallback stays.
- Warn whenever backend override is `auto` or `webgpu` (see `getBackendOverride()` in `src/platform.ts`) AND resolved device is not a real GPU (device `wasm`, or reason `webgpu-fallback-rejected`). Desktop-only (`isMobilePlatform()` in `src/platform.ts` false); phones default to WASM by design. The `webgpu-slow-warmup` reason from #0a is diagnostic only: show it in the settings line, do NOT warn on it.
- (i) PERMANENT warning at the TOP of the settings tab (`src/settings-tab.ts` `display()` ~line 143; the compute-backend segmented control is at ~613-621) — "Running on: WASM (CPU). WebGPU was requested but no usable GPU adapter was found (<reason>). Indexing will be much slower." When on a real GPU show a calm one-liner "Running on: WebGPU — <vendor> <description>".
- (ii) POP-UP (`new Notice(...)`, see existing usages `src/main.ts` ~378, ~569, ~903) at EVERY reindex start while the condition holds. Anchor: the plugin-level full-reindex method in `src/main.ts` that toasts `'Seeker: full reindex starting…'` (~line 2016) and then awaits `ensureModelLoaded()`; fire the warning AFTER the model load resolves (the resolved backend is only known once `LocalEmbedder.load` returns — before the first load of a session `getResolvedBackend()` holds the PREVIOUS session's record from localStorage, or null on a fresh install).
- Settings line before any load this session: show the stored record if present, else "Not loaded yet" — never a warning based on a missing record.
- (iii) Linux pop-up carries the troubleshooting recipe. Tailor: if `process.env.FLATPAK_ID` (or `process.env.container === 'flatpak'`) is readable from the plugin (verify: Obsidian desktop renderer exposes Node `process`; guard with typeof checks and never crash if absent) show the `user-flags.conf` recipe; otherwise the command-line recipe. Pop-up text must be plain language, say what is wrong and how to fix it, and link to the README section.

## Recipe to document (verified by the maintainer)
Reference host (verified 2026-09-02): Fedora Linux, AMD Ryzen AI MAX+ 395 w/ Radeon 8060S iGPU (32 threads), Obsidian 1.13.7 Flatpak, Electron 43.3.0 / Chrome 150. Without flags `navigator.gpu` exists but `requestAdapter()` returns null -> plugin silently resolved to WASM while the setting said Force WebGPU. Verified working flags: `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`. Flatpak persists flags in `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf` (one flag per line).
- Flatpak: append each flag on its own line to `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf`, restart Obsidian.
- AppImage/rpm/tarball: launch `obsidian <flags>` or edit the `.desktop` `Exec=` line.
- Verify: DevTools console `await navigator.gpu?.requestAdapter()` returns a non-null adapter whose `info.vendor` is not `google`; Seeker settings then shows "Running on: WebGPU".
- If it does not work: add `--ozone-platform=x11` (Wayland issues); `--disable-gpu-compositing` only for grey video artifacts.

## Files
- `src/settings-tab.ts`, `src/main.ts`, `src/platform.ts` (read-only use), `README.md` (new section "WebGPU on Linux"), new `src/backend-warning.ts` holding the pure decision `shouldWarn(override, resolved, isMobile) -> {warn: boolean; reason}` and the message builders (Obsidian-free, unit-tested).
- Tests: `src/backend-warning.test.ts` (one assert per case: auto+wasm desktop -> warn; wasm override -> no warn; mobile -> no warn; webgpu real -> no warn; software-rejected -> warn with reason), settings render smoke via existing patterns in `src/settings-tab` tests if any.

## Constraints
- Popout-window convention: `window.setTimeout` / `activeWindow`.
- Keep strings user-vocabulary ("GPU", "CPU"), no raw codes except the reason in parentheses.

## Acceptance Criteria

Settings tab shows the resolved backend line at the top; on desktop with auto/webgpu override and non-real-GPU a warning is shown permanently and a Notice fires at every reindex start; Linux pop-up shows Flatpak or generic recipe; README has the verified recipe; unit tests for shouldWarn pass.

