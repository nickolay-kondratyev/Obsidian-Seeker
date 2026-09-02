---
closed_iso: 2026-09-02T22:55:43Z
id: nid_h8a1jyl4pi07hbn94qb9ku1g9_e
title: 'Plan: speed up desktop indexing throughput (bench-first)'
status: closed
deps: []
links: []
created_iso: '2026-09-02T21:12:28Z'
status_updated_iso: 2026-09-02T22:55:43Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, indexing, desktop, webgpu, plan, decide, bench-first]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker
---
TASK: **PLAN**. Reach a shared understanding of this ticket before writing any plan.

## Interview
Grill me until nothing is silently assumed. Treat the work as a **design tree**: every decision branches into the decisions that hang off it.

Work in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you haven't heard. Ask the whole frontier in one round. A question that depends on another question still open this round belongs in a later round.

Finding facts is your job, never mine. If a question needs a fact from the code base or environment, dispatch the cheaper `Explore-cheap` sub-agent. Don't block the round on it: only questions downstream of that exploration wait. Decisions are mine: put each one to me and wait.

## Asking
Do NOT use AskUserQuestion. Each round, overwrite `.out/current_decision.md` (git-ignored) with:
1. A CONCISE summary of the problem with enough background to grasp the key tradeoffs.
2. The numbered frontier, formatted:

❓ **Q1** - **<question title>**: <question body, may include multiple choices>

➡️ <your recommended answer>

---

Then tell me to read the file and reply. DON'T RUSH: every decision gets signed off one by one by the HUMAN. After each reply, recompute the frontier (settled decisions unblock new questions) and ask the next round. The interview is done when the frontier is empty and I confirm we have a shared understanding.

## Output
Only after that confirmation, write the detailed plan with requirements of what we want to achieve.
IF multiple tickets are needed
  THEN put the high-level plan into a new ticket and `close` it,
       AND create focused implementation tickets with `ticket dep <impl-id> <plan-id>` so they reference the closed plan ticket
  ELSE put the plan into a new `open` ticket.
Favor focused tickets over large ones; split so each ticket fits in a 200K context window. The plan will be executed by a capable but less capable model than you, so put key details into the tickets. Every ticket must be self contained, with files referenced by full relative path from the git root.
Finally `close` this ticket.

--------------------------------------------------------------------------------


## Goal
Desktop indexing/embedding feels slow even on powerful machines with WebGPU forced (reported by the maintainer and other users). This is a PLANNING ticket: produce a concrete speedup plan, and BUILD A THROUGHPUT BENCH FIRST so every later change is measured, not guessed. No production perf changes land under this ticket — it yields (a) a repeatable bench and (b) a plan that spawns implementation tickets.

## Context / findings (from a code walkthrough on 2026-09-02)
The embedder runs a real WebGPU ONNX Runtime session when available (device `webgpu`/`auto`, guarded by `navigator.gpu`), see `src/iframe-runner.ts` `tryWebgpu`/`loadModel` (~lines 738-880). So the GPU IS used; the problem is it is intentionally under-fed. Four structural throttles:

1. Idle-gated dispatch: `src/pacer.ts` `CompositorPacer.pace()` waits on `requestIdleCallback` between EVERY embed batch to yield the shared GPU queue to Obsidian's compositor. Great for UI smoothness, but on a fast desktop it leaves the GPU idle between tiny bursts.
2. Serialized dispatch: one iframe, one pipeline, one batch in flight at a time, awaited (the embed flush loop in `src/search.ts`, see the module comment ~lines 56-90 and `rollingBatchFor`). No overlap/pipelining.
3. Tiny batches: `rollingBatchFor` (`src/search.ts` ~line 90) uses `ROLLING_MAX = 8` and a 512-token budget, so most dispatches are batch 1-8. The warmup grid warms exactly 1..8 (`src/iframe-runner.ts` warmup comment ~lines 811-820).
4. Dead desktop ceiling: `embedBatchCeiling()` in `src/platform.ts` (~line 131) returns 32 on desktop but has NO callers anywhere in production code (only its own definition/test). So the intended larger desktop batch was written but never wired in; desktop currently runs mobile-grade batch<=8 sizing.

All tuning is mobile-first (thermal/battery envelope), and the throttles are centralized (`pacer.ts` + `rollingBatchFor` + unused `embedBatchCeiling`), so the code is well-shaped to add a desktop "performance mode".

## No perf tests today
The 1167-test suite has NO indexing/throughput benchmark. Only `src/binary.test.ts` has a gated micro-bench (`describe.skipIf(!process.env.BENCH)`) for binary candidate scoring — unrelated to model inference. Sidecar perf cases are explicitly excluded from assertions. There is an in-app `LocalEmbedder.profile()` / `RawProfile` diagnostic (`src/embedder.ts` ~line 549) but it is not a CI/repo bench.

## Scope of THIS ticket (planning + bench only)
1. Build a repeatable embedding/indexing throughput bench (chunks/s and files/s) that can run on desktop, gated so `npm run test` stays fast (follow the `process.env.BENCH` pattern already in `src/binary.test.ts`). Decide: pure-embedder microbench vs full index-pass bench vs both; how to get a WebGPU-capable environment (headless is a known question — likely needs a real Electron/Chromium run, cross-ref the obsidian-add-e2e skill/harness) vs a WASM-CPU baseline that at least measures batch-size/pacing effects deterministically.
2. Capture a BASELINE number on the maintainer's machine with today's settings.
3. Write the speedup plan and spawn implementation tickets, candidate levers to evaluate (each measured against the bench):
   - Wire up `embedBatchCeiling()` and raise `ROLLING_MAX`/token budget on desktop; extend the iframe warmup grid to match.
   - Make `CompositorPacer` desktop-aware (skip/relax idle-gating, or pace only under real compositor pressure / when window focused).
   - Overlap dispatches / allow >1 in flight (bounded by ORT-Web single-device-thread — likely lower ROI).
   - Gate all of the above behind a desktop "performance mode" setting.

## DECIDE items (need maintainer input during planning)
- Bench environment: real-Electron/WebGPU harness vs WASM-CPU deterministic bench vs both. Tradeoff: WebGPU is the real target but hard to automate/CI; WASM-CPU is reproducible in CI but does not measure GPU saturation.
- How aggressive the default desktop pacing should be (UI-smoothness vs throughput) and whether performance mode is opt-in or default-on for desktop.

## Acceptance criteria
- A gated, repeatable throughput bench exists in the repo (does not run in the default `npm run test`), documented with how to run it.
- A recorded baseline throughput number for today's desktop settings.
- A written speedup plan with prioritized levers, each mapped to a follow-up implementation ticket (created with `deps` on this planning ticket).
- No production behavior change to indexing/pacing lands under THIS ticket.

## Notes

**2026-09-02T21:17:59Z**

Interview round 1 written to .out/current_decision.md (7 questions: metric/corpus, bench env, hw scope, index paths, lever scope, pacing policy shape, baseline process). Verified all 4 throttle claims; extra facts: profile() diagnostic has no caller; headless Obsidian e2e runs --disable-gpu so real WebGPU numbers require maintainer's Mac; ROLLING_BUDGET is 512 (comment says 1536). Awaiting human replies.

**2026-09-02T21:38:16Z**

Round 1 answered (wall-clock headline, synthetic corpus, CPU-idle gate, full reindex only, dispatch levers only, adaptive pacing (b) + opt-in perf mode, host = Fedora Ryzen AI MAX+ 395/Radeon 8060S; container has no GPU, human runs host scripts). Round 2 written to .out/current_decision.md. KEY FINDING: Chrome on Linux AMD (incl. this exact chip, public report on Chrome 146) has Vulkan/WebGPU off by default -> plugin's 'Force WebGPU' maps to auto and silently falls back to WASM; settings never show resolved backend. Hypothesis: slowness = WASM CPU, not under-fed GPU. Host check snippet at .out/host-check-webgpu.js awaiting user's output.

**2026-09-02T22:03:00Z**

CONFIRMED lever #0: host check showed override=webgpu, active=wasm, requestAdapter()=null on Obsidian 1.13.7 Flatpak (Electron 43.3.0 / Chrome 150). Launching with Vulkan/WebGPU chromium flags made indexing 'way faster'. Flatpak persists flags via ~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf. Round 3 written to .out/current_decision.md (branch A: lever #0 decisions Q1-Q6; branch B: bench design Q7-Q14 carried from round 2). Awaiting answers.

**2026-09-02T22:09:04Z**

Lever #0 shape decided by human: fall back to WASM but WARNING pop-up + permanent settings WARNING whenever backend is auto/Force WebGPU and embedder is not on a real GPU; Linux pop-up carries the troubleshooting recipe that worked. Detection = null adapter OR software adapter (fallback flag / swiftshader|llvmpipe|lavapipe strings) OR implausibly slow warmup (diagnostic only). Round 4 written to .out/current_decision.md: remaining lever-#0 details (exact flags, Flatpak-tailored popup, cadence, mobile exemption, ordering, baseline pair) + bench design Q7-Q14 still unanswered.

**2026-09-02T22:12:48Z**

Verified flag set (human, Fedora Linux, AMD Ryzen AI MAX+ 395 / Radeon 8060S, Obsidian 1.13.7 Flatpak): --enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist. Q2-Q14 in .out/current_decision.md still open.

**2026-09-02T22:19:08Z**

Round 4 answered: Flatpak-tailored popup (a); popup cadence = every reindex start (c); warning desktop-only; lever #0 ships first; two baselines; runner = vitest browser mode (a); .bench-cache profile (a); CONTAINER BENCH IS PRIMARY (agents self-iterate, <20-30 s) + nice host script for full GPU bench; corpus = committed seeded realistic Markdown generated by a sub-agent under a data folder; CPU gate abort (a); results (a); reps/threshold accepted; perf mode desktop-only. Round 5 (cost model, pacing model, corpus composition, overlap lever, final confirmation) being asked.

**2026-09-02T22:22:31Z**

Human corrected: container bench should run REAL CPU inference, not a fake embedder. Verified headless Chromium 151 in container: WASM SIMD, rIC, 32 cores, CDN reachable; with --enable-unsafe-webgpu it exposes a SwiftShader adapter (vendor 'google', no isFallbackAdapter on adapter object) = reproducible software-WebGPU case for lever #0 tests. Round 5 revised: one vitest browser-mode harness with BENCH_DEVICE=wasm|webgpu|webgpu-software.

**2026-09-02T22:30:07Z**

Round 5 accepted as recommended: one vitest browser-mode harness (BENCH_DEVICE=wasm|webgpu|webgpu-software), software-WebGPU detection test, ~300-note realistic committed corpus, overlap experiment as p3 measure-then-keep-or-revert, plan order confirmed. Interview complete pending chunking Q from human.

--------------------------------------------------------------------------------

## RESOLUTION (2026-09-02)

Interview completed over 5 rounds (all decisions human-approved; notes above record each round). Outcome:

- **Root cause #1 found and confirmed on the reference host**: the plugin was NOT on the GPU. On Fedora (AMD Ryzen AI MAX+ 395 / Radeon 8060S, Obsidian 1.13.7 Flatpak, Chrome 150) `requestAdapter()` returns null because Chromium on Linux ships with Vulkan/WebGPU off for AMD; `resolveDevice()` maps Force WebGPU to auto and silently falls back to WASM. Launching with `--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist` made indexing "way faster". Hence a new lever #0 (detection + warnings + Linux recipe) ships first.
- **Root cause #2 (real-GPU under-feeding)** stays as described in the findings above, gated behind a bench.
- **Bench design**: one vitest browser-mode harness on the REAL embedder/orchestrator/IndexedDB with `BENCH_DEVICE=wasm|webgpu|webgpu-software`; container runs WASM (< 20 s, agents self-iterate), host runs WebGPU (decider); committed realistic corpus under `bench/corpus/`; CPU-idle gate; 1 warm-up + 3 reps median; >= 10% rule; results in `.bench/results.ndjson`, baselines in `docs/perf-bench.md`.

Plan of record (closed epic): **nid_mw6gkmuurjhiqva4rr6doenul_e**. Implementation tickets (deps encode order):
- nid_yketo7yrdmkfdhbvywrzgux74_e Lever #0a adapter classification + software-adapter rejection
- nid_9onhu2309zfy32w37xtmz8a0p_e Lever #0b settings warning + reindex pop-up + Linux recipe (README)
- nid_9xdumruajy1oru6nlz6g3y1ag_e Bench corpus
- nid_pt77674z2iel2w8rmdga3bvkb_e Bench harness (browser mode, real embedder)
- nid_eiq9gtj7yeiic6cgztef2c0ki_e Bench runner ergonomics + docs/perf-bench.md + CLAUDE.md pointer
- nid_ao3yiodwpuanpxzcuyppja2w0_e Software-WebGPU rejection browser test
- nid_d5o2w9eb3d1l885d2q8kk992l_e Baseline pair capture (need-human)
- nid_0yhtxzgrmly7zk6m6quiqfpil_e Lever 1 desktop batch sizing
- nid_td0kh5ezmq4tkfmhfx82d1pcr_e Lever 2 adaptive pacing + Performance mode
- nid_shw3c2udyuva92sa81oa5qxyg_e Overlap experiment (p3)

Also landed under this ticket: chunking "pipeline at a glance" comment in `src/chunker.ts` and §Chunking in `src/CLAUDE.md` (revisit chunking when user-selectable models land). No production indexing/pacing behavior changed.
