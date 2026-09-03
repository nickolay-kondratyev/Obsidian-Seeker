---
closed_iso: 2026-09-03T20:40:27Z
id: nid_5zn22onkawouvyt69fp11hjs0_e
title: E2E tests with basic functionality
status: closed
deps: []
links: []
created_iso: '2026-09-03T20:26:34Z'
status_updated_iso: 2026-09-03T20:40:27Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-2
---
--------------------------------------------------------------------------------
TASK: **PLAN**. Reach a shared understanding of this ticket before writing any plan.

## Interview
Treat the work as a design tree: each decision unlocks the decisions below it. Work in rounds. Each round, ask every question whose prerequisites are settled; questions that depend on an open question wait for a later round.

Split decisions into two kinds:
- **AGENT decides**: anything a fact settles, or where one option is clearly right. Find facts yourself (dispatch `Explore-cheap` for code base or environment questions; don't block the round on it). Decide, and list each decision with a one-line reason so the HUMAN can veto.
- **HUMAN decides**: true judgment calls: tradeoffs, scope, product intent, anything the AGENT would only be guessing at. Put each to the HUMAN and wait.

A question goes to the HUMAN only if it clears this bar: the answer changes the plan, AND it cannot be settled by a fact, AND the ticket, code base, or conventions don't already imply the answer. If the answer could be inferred with reasonable confidence, make the call under AGENT decides and let the HUMAN veto. Do NOT ask questions to appear thorough. Zero questions is a valid and expected outcome for a clear ticket.

## Asking
Do NOT use AskUserQuestion. Each round, overwrite `.out/current_decision.md` (git-ignored) with:
1. A concise summary of the problem and the key tradeoffs.
2. **AGENT decided**: what you settled yourself, one line each.
3. **HUMAN decides**: the numbered questions, formatted:

❓ **Q1** - **<title>**: <question, may include options>

➡️ <AGENT's recommendation>

---

Then tell the HUMAN to read the file and reply. After each reply, recompute the frontier and ask the next round. Done when nothing is left to ask and the HUMAN confirms a shared understanding.

If the first round produces no HUMAN questions, still write the file (summary plus AGENT decided), tell the HUMAN it needs only a veto pass, and proceed to Output once they confirm or after they reply with no objections. Do not manufacture questions to fill the section.

## Output
Only after that confirmation, write the detailed plan with requirements.
IF multiple tickets are needed
THEN put the high-level plan into a new ticket and `close` it,
AND create focused implementation tickets with `ticket dep <impl-id> <plan-id>`
ELSE put the plan into a new `open` ticket.
Split so each ticket fits in a 200K context window and is self contained: full relative paths from git root, key details included, since a less capable model will execute it.
Finally `close` this ticket.
--------------------------------------------------------------------------------

Lets setup the basic E2E tests for search. '/Users/nkondrat/vintrin-env/config/claude/ai_input/deep/obsidian-how-to-setup-e2e-test.md' is how to setup the E2E tests context.

And as part of this ticket we will want to setup the some basic tests with search, you can pull some data out of the `e2e/retrieval.e2e.test.ts` which has quries and results.

## Notes

**2026-09-03T20:32:09Z**

PLAN interview round 1 written to .out/current_decision.md (8 AGENT decisions, 3 HUMAN questions: test:e2e naming, release.sh gating, scope of basic tests). Awaiting human reply before writing the plan/impl tickets. Facts gathered: runner=@playwright/test+CDP per deep memory; Obsidian pin 1.12.7; fixtures = e2e/datasets/cqadupstack-android/corpus + curated-queries.json; persistent .tmp/e2e/userdata for the model cache; plugin.runFullReindex({skipConfirm:true}) + command seeker:search are the drivable surface.

## Resolution (2026-09-03)
PLAN interview completed in two rounds (`.out/current_decision.md`); human ratified:
- Q1: `test:e2e` -> `test:e2e:retrieval`, new `test:e2e:obsidian`, combined `test:e2e` runs both sequentially.
- Q2/Q4: `release.sh` gates on the Obsidian suite (macOS default `OBSIDIAN_PATH`) and refuses to run inside a container with a NON-zero exit.
- Q3: basic scope only (modal opens, unindexed state, full reindex, 10 curated queries rank within bound, Enter opens note); leftovers as `status: follow-up` tickets.
Agent decisions (veto passed): `@playwright/test` + CDP attach per `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md`; Obsidian pinned 1.12.7; vault assembled per run from `e2e/datasets/cqadupstack-android/corpus`; expectations from `curated-queries.json`; persistent `.tmp/e2e/userdata` for the model cache.

Tickets created:
- Plan (closed): nid_t5n3efu9vt5yk1drwg27q2uog_e
- Impl 1: nid_q5flwbl6fzfu1eu69tyful8yg_e (script rename)
- Impl 2: nid_yz7qu6wa2w5u2mu6soip6jl1x_e (harness + basic suite) deps 1
- Impl 3: nid_pffuigo6cfoqt5gn71zm19d20_e (release.sh gate + container refusal) deps 2
- Follow-ups (status follow-up, deps 2): nid_nse92c0xs982hhwlqzbn73868_e filters, nid_ajrjpvzsa9byeco3plkf64aqj_e Build-index click, nid_efzom8fbm1yy7vzd8aqvdzafu_e recents, nid_lueflkttrdedaaloim4qvxdgk_e deep link, nid_zed3yyg8qjc67kba08rm9tzhv_e canvas/base.
