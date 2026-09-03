---
id: nid_727bwz8g26vhaqb0921npefaj_e
title: Add status bar on the botom to signal image and note status embedding wise
status: in_progress
deps: []
links: []
created_iso: '2026-09-03T22:59:34Z'
status_updated_iso: '2026-09-03T23:02:41Z'
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
IF any ticket needs a higher tier model to implement it, then set higher profile with CLI `ticket profile <id> higher`.
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
Right now there is no status indicator showing where we are in the indexing of notes and images.

I am thinking we add a status bar at the bottom right that shows the current progress on indexing while we are in the process of indexing, we want to show the progress of notes and images when they are not fully indexed.

When they are fully indexed we just want to have some completion icon like a check mark so we dont use up the status bar with something like 'Seeker notes 100/100, images 90/90' we would rather just show completion icon and on hover over it says that Seeker indexed status is indexed.

WHILE when we are in the process of indexing we actually would show something like 'Seeker notes: 80/90' or 'Seeker images: 10/30' to show the current progress.
