---
closed_iso: 2026-09-03T03:30:55Z
id: nid_ia9lbslebos19fli7s2g3b6i8_e
title: "Lever 1 follow-up: expose desktop-WebGPU batch sizing as an Advanced setting (preset ladder, benched default) — coordinate with lever 2 Performance mode"
status: closed
deps: [nid_0yhtxzgrmly7zk6m6quiqfpil_e, nid_td0kh5ezmq4tkfmhfx82d1pcr_e]
links: []
created_iso: 2026-09-03T02:40:38Z
status_updated_iso: 2026-09-03T03:30:55Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, settings]
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


## Notes

**2026-09-03T03:30:55Z**

## DECISION (human, 2026-09-03): NO separate setting. Folded into lever 2 (nid_td0kh5ezmq4tkfmhfx82d1pcr_e). Closed.

- No Advanced preset ladder and no debug budget/max override. The sweep is a plateau (every 1024–4096 × 16/32 candidate within a 4-point band), so a ladder would offer a throughput axis that does not exist; the only felt difference is the worst-case stall (p95 dispatch 17 ms at 512/8 vs 56 ms at 2048/32), which is exactly the tradeoff lever 2's Performance mode already owns. One knob, not two.
- Human's default policy: **do NOT stall the app by default, even if indexing takes longer.** Focused window + Performance mode off → base sizing 512/8 (today's stall profile, zero regression). Window unfocused/hidden OR Performance mode on → 2048/32 (the −17.5 % from the sweep). Recorded on the lever 2 ticket as its "focused sizing tier".
- Mechanics that make this cheap (no re-warm on switch): per bucket the 2048/32 warmup grid is a strict superset of the 512/8 grid (512:4≥1, 384:5≥1, 256:8≥2, 192:11≥3, 128:16≥4, 96:21≥5, ≤64:32≥8; `src/batch-sizing.test.ts` already pins base ⊆ desktop). Warm the largest tier's grid once; choose the flush sizing per pass (or per focus change) at runtime. Fingerprint unchanged.
- Debug override deferred: engineers have `BENCH_BATCH_SIZING` / `overrideDesktopWebgpuSizing`. Reopen trigger: a field report of UI hitches during reindex on another GPU class while unfocused/perf-mode (56 ms on a Radeon 8060S may be 150+ ms on a weak iGPU) — then consider a lower unfocused tier, not a user knob.
- Until lever 2 lands, main ships 2048/32 whenever desktop+WebGPU, focused or not (lever 1 as merged). Lever 2 is where the focused tier gets wired.
