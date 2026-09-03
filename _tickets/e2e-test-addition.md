---
id: nid_w9o911oolzzh9ytbi6tob3sek_e
title: "E2E test addition"
status: open
deps: []
links: []
created_iso: 2026-09-03T17:52:29Z
status_updated_iso: 2026-09-03T17:52:29Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
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


