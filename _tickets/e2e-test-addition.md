---
id: nid_w9o911oolzzh9ytbi6tob3sek_e
title: E2E test addition
status: open
deps: []
links: []
created_iso: '2026-09-03T17:52:29Z'
status_updated_iso: 2026-09-03T18:00:29Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-3
---
--------------------------------------------------------------------------------
TASK: **PLAN**. Reach a shared understanding of this ticket before writing any plan.

## Interview
Treat the work as a design tree: each decision unlocks the decisions below it. Work in rounds. Each round, ask every question whose prerequisites are settled; questions that depend on an open question wait for a later round.

Split decisions into two kinds:
- **AGENT decides**: anything a fact settles, or where one option is clearly right. Find facts yourself (dispatch `Explore-cheap` for code base or environment questions; don't block the round on it). Decide, and list each decision with a one-line reason so the HUMAN can veto.
- **HUMAN decides**: true judgment calls: tradeoffs, scope, product intent, anything the AGENT would only be guessing at. Put each to the HUMAN and wait.

## Asking
Do NOT use AskUserQuestion. Each round, overwrite `.out/current_decision.md` (git-ignored) with:
1. A concise summary of the problem and the key tradeoffs.
2. **AGENT decided**: what you settled yourself, one line each.
3. **HUMAN decides**: the numbered questions, formatted:

❓ **Q1** - **<title>**: <question, may include options>

➡️ <AGENT's recommendation>

---

Then tell the HUMAN to read the file and reply. After each reply, recompute the frontier and ask the next round. Done when nothing is left to ask and the HUMAN confirms a shared understanding.

## Output
Only after that confirmation, write the detailed plan with requirements.
IF multiple tickets are needed
THEN put the high-level plan into a new ticket and `close` it,
AND create focused implementation tickets with `ticket dep <impl-id> <plan-id>`
ELSE put the plan into a new `open` ticket.
Split so each ticket fits in a 200K context window and is self contained: full relative paths from git root, key details included, since a less capable model will execute it.
Finally `close` this ticket.
--------------------------------------------------------------------------------

Let's plan how to add E2E tests that can run reliably within container. 

I am thinking the E2E tests will do actual embedding and query for relevant results. We want a mix of semantic and keyword queries and be able to test that we are getting expected results. I am thinking that we should be able to lean on the data set that exists for this like 'BEIR' data set. 

Right now this planning ticket. Research, plan and ask for judgement calls. Output: is a plan

## Notes

**2026-09-03T18:00:29Z**

PLAN interview, round 1 written to .out/current_decision.md (git-ignored; regenerate from this note if lost). Waiting on HUMAN answers to Q1-Q7 before writing the plan.

Facts established (so the next agent need not re-research):
- Real-stack browser harness already exists: bench/harness/run.mjs + bench/harness/page.ts run LocalEmbedder -> transformers.js, SearchOrchestrator, IndexStore on real IndexedDB in headless /usr/bin/chromium (wasm) inside the container; model (~100 MB) cached in .bench-cache/. Only Vault is faked (src/test-harness/fake-vault.ts). page.ts exposes reindex only; SearchOrchestrator.search(query, topK) (src/search.ts ~L3308) needs exposing for e2e.
- Container throughput ~4 chunks/s wasm (docs/perf-bench.md) => corpus size is bounded by the runtime budget.
- Fusion: hybrid = alpha*dense + (1-alpha)*bm25, alpha = settings.denseWeight (0.85). alpha=1/0 = pure channels.
- Prior tuning used BEIR CQADupstack android/gaming + DBpedia (comments in src/bm25.ts); no eval tooling in this repo.
- Gating precedent: bench/harness/webgpu-software.test.ts is a vitest test gated on BENCH=1 (skipped in npm test).
- obsidian-add-e2e skill (real Obsidian Electron under Playwright, headless-capable) is available as an alternative/complement.

AGENT-decided: build on the bench harness (new e2e/ dir), share .bench-cache, separate `npm run test:e2e` (not in npm test), commit a script-generated frozen BEIR subset (queries + all their qrels docs + seeded distractors), report nDCG@10/Recall@10/MRR@10 for hybrid/dense-only/bm25-only, wasm only.
HUMAN questions: Q1 scope (Chromium harness vs real-Obsidian Electron vs both; rec. harness now + Electron smoke as follow-up ticket), Q2 which BEIR set(s) (rec. CQADupstack-android + SciFact), Q3 runtime budget (rec. ~3 min => ~250 docs x 2 sets), Q4 assertion policy (rec. aggregate floors vs pinned baselines + curated must-pass queries), Q5 curated queries against frozen bench/corpus (rec. yes), Q6 gate per-channel too (rec. yes), Q7 where it runs (rec. local + release.sh gate; CI later).
