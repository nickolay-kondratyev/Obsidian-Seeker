---
id: nid_ia9lbslebos19fli7s2g3b6i8_e
title: "Lever 1 follow-up: expose desktop-WebGPU batch sizing as an Advanced setting (preset ladder, benched default) — coordinate with lever 2 Performance mode"
status: open
deps: [nid_0yhtxzgrmly7zk6m6quiqfpil_e, nid_td0kh5ezmq4tkfmhfx82d1pcr_e]
links: []
created_iso: 2026-09-03T02:40:38Z
status_updated_iso: 2026-09-03T02:40:38Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, settings, decide]
---

Context: lever 1 (nid_0yhtxzgrmly7zk6m6quiqfpil_e) ships `DESKTOP_WEBGPU_BATCH_SIZING = 2048/32` in `src/batch-sizing.ts`, measured on ONE GPU class (Radeon 8060S iGPU) by `npm run bench:sweep` (`docs/perf-bench.md`, "Lever 1"). The human asked whether this should become a user setting with the benched value as default. Answer: yes, but not as two raw integers.

What the sweep says about the shape of the setting: every candidate 1024-4096 x 16/32 landed in a 4-point band (-13.8 .. -17.5 % wall-clock), so on this GPU the exact pair barely matters; what a user can actually feel is the worst-case UI stall = the largest dispatch (budgetTokens caps it: 512 -> p95 17 ms, 2048 -> 56 ms, 4096 -> ~115 ms). So the honest knob is "how long may indexing stall the UI", not "budget/max".

Proposed design (decide):
- A preset ladder under Advanced settings, desktop-WebGPU only (mobile and WASM keep the base sizing by design, `src/batch-sizing.ts` doc comment): e.g. Gentle = 512/8 (base, shortest stall), Balanced = 2048/32 (benched default), Fast = 4096/32 (bigger stall; only if a future GPU class shows a real gain there — on the reference host it buys nothing). Presets are named in the user's vocabulary (stall vs throughput), each row documented with the measured p95 dispatch.
- Strongly consider folding this into lever 2's opt-in Performance mode (nid_td0kh5ezmq4tkfmhfx82d1pcr_e) instead of a separate setting: both trade UI smoothness for indexing throughput and two knobs for one tradeoff violates "don't make me think".
- A debug-only raw `budget/max` override (like the existing debug model override in settings) so users on other GPU classes can report numbers; bounded to the swept range (budget 512..4096, max 8..32).
- Mechanics: `batchSizingFor` in `src/batch-sizing.ts` is the ONE resolver (flush size in `src/search.ts`, warmup grid + fingerprint in `src/embedder.ts` all read it; the bench override `overrideDesktopWebgpuSizing` shows the injection shape). The grid + fingerprint are derived at embedder load, so a settings change must recycle/reload the embedder (new grid -> fingerprint miss -> re-warm, ~1-2 s cold). Never let a setting emit a shape outside the warmed grid (the ORT-Web overflow path, `embedRecycles`).
- Tests: sizing resolution per preset x platform x device; a change re-warms; bounds enforced.

Depends on lever 1 (shipped constant is the default) and should be sequenced with lever 2 (shared setting surface).

## Acceptance Criteria

Decision recorded (separate Advanced preset vs folded into Performance mode); desktop-WebGPU-only preset with 2048/32 as default; mobile/WASM sizing byte-identical; changing the preset re-warms the grid (fingerprint miss) and cannot emit an un-warmed shape; covered by unit tests; docs/perf-bench.md notes the presets with their measured p95 dispatch.

