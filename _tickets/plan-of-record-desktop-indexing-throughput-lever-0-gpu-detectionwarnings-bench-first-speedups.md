---
closed_iso: 2026-09-02T22:54:56Z
id: nid_mw6gkmuurjhiqva4rr6doenul_e
title: "Plan of record: desktop indexing throughput — lever #0 (GPU detection/warnings) + bench-first speedups"
status: closed
deps: []
links: []
created_iso: 2026-09-02T22:54:53Z
status_updated_iso: 2026-09-02T22:54:56Z
type: epic
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, plan]
---

PLAN OF RECORD (closed on creation; implementation tickets depend on it). Produced by the interview on planning ticket nid_h8a1jyl4pi07hbn94qb9ku1g9_e (2026-09-02).

## Problem
Desktop indexing felt slow "even with WebGPU forced". Two independent causes, in priority order:

1. **The plugin was not on the GPU at all (reference host).** Chrome on Linux ships with Vulkan/WebGPU off for AMD (only Intel Gen12+ and NVIDIA are on by default, per the gpuweb Implementation-Status wiki). `src/platform.ts` `resolveDevice()` maps the user's `webgpu` override to `'auto'`, and `src/iframe-runner.ts` (~line 797) silently falls back to WASM when `navigator.gpu.requestAdapter()` returns null. Nothing in the UI shows the resolved backend (it is only stamped into `localStorage['seek-active-backend']` by `recordActiveBackend` — defined in `src/platform.ts` ~line 69, called from `src/main.ts` ~line 1046 — and into the NDJSON log). Launching Obsidian with the Chromium Vulkan flags made indexing "way faster" (maintainer, 2026-09-02).
   Reference host (verified 2026-09-02): Fedora Linux, AMD Ryzen AI MAX+ 395 w/ Radeon 8060S iGPU (32 threads), Obsidian 1.13.7 Flatpak, Electron 43.3.0 / Chrome 150. Without flags `navigator.gpu` exists but `requestAdapter()` returns null -> plugin silently resolved to WASM while the setting said Force WebGPU. Verified working flags: `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist`. Flatpak persists flags in `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf` (one flag per line).
2. **When WebGPU IS real, it is under-fed** (all verified in code): (a) `src/pacer.ts` `CompositorPacer.pace()` waits on `requestIdleCallback` after EVERY embed batch (`src/search.ts` ~line 844); (b) one batch in flight, awaited (`embedOneBatch`, `src/search.ts` ~799-847); (c) tiny batches: `ROLLING_BUDGET = 512`, `ROLLING_MAX = 8` (`src/search.ts` ~80-91; the comment above still says 1536 -> stale) so dispatches are batch 1..8; (d) `embedBatchCeiling()` in `src/platform.ts` ~line 131 returns 32 on desktop but has ZERO callers. Warmup grid `WARMUP_BATCH_SIZES = [1..8]` x `SEQ_BUCKETS` in `src/iframe-runner.ts` lines 61-62 must stay in sync with any new batch shapes (ORT-Web WebGPU SafeInt-overflow history, see comments there).

## Decisions of record (human-approved)
- Headline metric: **wall-clock of a full reindex** of a committed synthetic corpus; also chunks/s, files/s, plus structural counters (dispatches, effective batch, padded tokens, pace-wait ms) that `src/search.ts` already computes (~1431-1433, ~1525-1526).
- Scope: full reindex only; dispatch-level levers only (model/runtime levers are accuracy work, out of scope).
- Bench = ONE vitest browser-mode harness (Playwright Chromium) running the REAL `IframeRunner`/`LocalEmbedder` + REAL `SearchOrchestrator` + REAL IndexedDB on the corpus, `BENCH_DEVICE=wasm` (container/CI-less default, headless, capped by `BENCH_FILES` to < 20 s) | `webgpu` (host, launched with the verified flags) | `webgpu-software` (container, SwiftShader appears under `--enable-unsafe-webgpu`; used to test rejection). Agents self-iterate on the container WASM run; the host WebGPU run is the decider for batching/pacing levers (on WASM batch size is a known wash, `src/search.ts` ~82-88, and pacing is nearly free headless).
- No fake-embedder bench. The Node scenario harness `src/test-harness/scenario.ts` stays for invariants only.
- Corpus: ~300 realistic Markdown notes committed under `bench/corpus/` (generated once by a sub-agent), lengths spread so every `SEQ_BUCKETS` entry (32..512) is hit, a few long single sections to exercise `src/token-budget.ts` split + 15% within-section overlap.
- CPU-idle gate: sample ~2 s before a run; busy > 20% -> abort; `BENCH_FORCE=1` overrides.
- Results: print + append JSON line to git-ignored `.bench/results.ndjson`; baselines hand-copied into checked-in `docs/perf-bench.md`, linked from `CLAUDE.md`.
- Reps: 1 warm-up + 3 measured, report median + spread. A lever counts as an improvement at >= 10% median wall-clock gain with spread below that, on the host WebGPU run.
- Lever #0 policy: NEVER break search — fall back to WASM — but (i) permanent WARNING in the settings tab and (ii) WARNING pop-up at EVERY reindex start whenever the backend override is `auto` or `webgpu` and the embedder is not on a real GPU; (iii) on Linux the pop-up carries the troubleshooting recipe, tailored to Flatpak when `FLATPAK_ID` is detectable, else generic. Desktop-only (phones default to WASM on purpose). "Not a real GPU" = null adapter OR software adapter (fallback flag on adapter or `adapter.info`; vendor/description matching swiftshader | llvmpipe | lavapipe; observed in-container: vendor `google`, empty description, no `isFallbackAdapter` on the adapter object) OR implausibly slow warmup (diagnostic warning only, not a gate). Software adapters are REJECTED -> WASM, logged `webgpu-fallback-rejected`.
- Pacing policy shape (lever 2): adaptive default — full speed (no idle gate, bigger batches) when the Obsidian window is unfocused or hidden; paced when focused but with bigger desktop batches than today; plus opt-in **Performance mode** toggle at the TOP of settings with a tradeoff explanation, desktop-only. Exact aggressiveness is bench-driven.
- Overlap (two dispatches in flight) is a p3 experiment: measure, keep only if >= 10%, else revert.
- Chunking is model-coupled and gets revisited when user-selectable models land (see `src/CLAUDE.md` §Chunking) — not part of this plan.

## Plan order (implementation tickets are listed in the note appended below; deps encode this order)
1. Lever #0a detection + rejection (no bench needed) -> 2. Lever #0b warnings + Linux recipe -> ships first.
3. Corpus -> 4. Bench harness -> 5. Runner ergonomics/docs -> 6. Software-WebGPU rejection test.
7. Baseline pair on the host (need-human).
8. Lever 1 batch sizing -> 9. Lever 2 adaptive pacing + Performance mode -> 10. Overlap experiment.



## Notes

**2026-09-02T22:54:56Z**

Implementation tickets (deps encode order):
- nid_yketo7yrdmkfdhbvywrzgux74_e Lever #0a detection/rejection
- nid_9onhu2309zfy32w37xtmz8a0p_e Lever #0b warnings + Linux recipe (dep #0a)
- nid_9xdumruajy1oru6nlz6g3y1ag_e Corpus
- nid_pt77674z2iel2w8rmdga3bvkb_e Bench harness (dep corpus)
- nid_eiq9gtj7yeiic6cgztef2c0ki_e Runner ergonomics/docs (dep harness)
- nid_ao3yiodwpuanpxzcuyppja2w0_e Software-WebGPU rejection test (dep #0a, harness)
- nid_d5o2w9eb3d1l885d2q8kk992l_e Baseline pair, need-human (dep ergonomics)
- nid_0yhtxzgrmly7zk6m6quiqfpil_e Lever 1 batch sizing (dep baseline)
- nid_td0kh5ezmq4tkfmhfx82d1pcr_e Lever 2 adaptive pacing + Performance mode (dep lever 1)
- nid_shw3c2udyuva92sa81oa5qxyg_e Overlap experiment p3 (dep lever 2)

**2026-09-02T23:04:58Z**

Ticket review 2026-09-02: the bench-harness decision 'vitest browser mode' conflicts with the '.bench-cache persistent profile' decision (Playwright launch() rejects --user-data-dir; only launchPersistentContext keeps the ~100 MB model cached, which the < 20 s container target needs). Harness ticket nid_pt77674z2iel2w8rmdga3bvkb_e rewritten around a standalone Playwright script (same real stack, same JSON) and tagged decide for human sign-off. Other fixes: lever 1 sizing keyed on desktop+webgpu only (desktop-WASM keeps today's sizing), per-bucket warmup grid, lever 0a slow-warmup probe (warmup loop is not per-pass timed and may be skipped), corpus test API (MarkdownChunker.chunkContent + embedInput + selectBucket), rejection test now spawns the harness probe mode (BENCH_PROBE=1, new webgpu-absent mode).
