---
id: nid_h8a1jyl4pi07hbn94qb9ku1g9_e
title: 'Plan: speed up desktop indexing throughput (bench-first)'
status: in_progress
deps: []
links: []
created_iso: '2026-09-02T21:12:28Z'
status_updated_iso: '2026-09-02T21:15:02Z'
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
