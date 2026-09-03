---
closed_iso: 2026-09-03T23:18:18Z
id: nid_727bwz8g26vhaqb0921npefaj_e
title: Add status bar on the botom to signal image and note status embedding wise
status: closed
deps: []
links: []
created_iso: '2026-09-03T22:59:34Z'
status_updated_iso: 2026-09-03T23:18:18Z
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


--------------------------------------------------------------------------------
## Agent progress log

### 2026-09-03 — PLAN interview round 1 written, awaiting HUMAN reply
Agent gathered codebase facts and wrote interview round 1 to `.out/current_decision.md` (git-ignored; verbatim copy below). Not yet done: HUMAN answers to Q1–Q3 / veto pass on AGENT decisions, then the Output step (plan ticket + implementation tickets). Next agent: if `.out/current_decision.md` is missing, recreate it from the copy below, then continue the interview.

<details><summary>Round 1 (copy of .out/current_decision.md)</summary>

# Ticket nid_727bwz8g26vhaqb0921npefaj_e — Status-bar indexing indicator (notes + images)

## Summary
Today indexing progress is visible only as transient toasts (`Seeker: full reindex starting…`, end summary) and inside the settings Index card, which **regex-parses** the free-form `onProgress` string `"Indexed N files · M chunks"` (`src/settings-tab.ts:567`). Nothing in the main UI tells the user "are my notes/images searchable yet?".

Facts found:
- No status-bar item exists (`addStatusBarItem` unused). Obsidian's status bar is desktop-only; the API is a no-op on mobile.
- Notes and images are embedded in the **same pass** (`embedAndCommitFiles`, `src/search.ts:659`); images additionally go through an **OCR pre-pass** first (`ocrPrepass`, `src/search.ts:1797`, reports `"OCR done/total"`). Image indexing is opt-in (`settings.indexImages`, default off).
- Progress is a single combined file counter (`filesCommitted` / `totalChunks`); there is no per-type (note vs image) count today, but the file list is known up front and each `TFile` is trivially classifiable (`isIndexableImagePath`), so per-type `done/total` is cheap to add.
- Beyond "running" there are **idle-but-not-current** states: deferred embeds (`catchUpPending`, cold model on mobile / bulk cold desktop / peer-ahead), images waiting for OCR text from another device (`filesWaitingOcr`), and health `degraded`/`recovering`.

Key tradeoff: a bare check mark is only honest if "done" really means "everything indexable is indexed". The deferred/waiting states must map to *something* that is not a check mark, or the icon lies.

## AGENT decided (veto if wrong)
1. **Add a structured progress event alongside the string channel** (e.g. `{ phase: 'ocr'|'embed', notes: {done,total}, images: {done,total} }`) emitted from `search.ts`, consumed by the status bar AND the settings card (which today regex-parses the string, `src/settings-tab.ts:567`). The e2e suite (`e2e/search.e2e.ts:35`) also parses the string; it keeps working because the string channel stays for logs/toasts. Reason: DRY — a second regex consumer would be the third copy of the same knowledge.
2. **One `StatusBarController` class** in a new `src/status-bar.ts` (pure state→render mapping unit-testable without Obsidian; thin `addStatusBarItem` glue in `main.ts`). Reason: SRP, matches flat-module layout.
3. **Text while busy, icon when done**, per ticket: `Seeker notes 80/90 · images 10/30` while embedding; `Seeker OCR 3/12` during the OCR pre-pass; check icon + hover tooltip `Seeker: index up to date` when complete. Image segment omitted entirely when `indexImages` is off.
4. **Show `Seeker: loading model…` during model load** (`TaskContext 'model-load'`, `src/task-context.ts`). Reason: a first-run ~250 MB download is the longest silent wait; the bar exists to end silence.
5. **Drive "busy" from the same sources the settings card uses** (`isIndexing`, `reindexPhase`, `indexHealthState`) plus the new progress events. Reason: one truth; no new state machine.
6. **Desktop only, no mobile fallback.** Obsidian has no status bar on mobile; the settings card already covers it. Reason: 80/20.
7. **Click on the status-bar item opens Seeker settings** (the Index card). Reason: cheap, conventional, gives a drill-down for the hover text.
8. **Tests**: unit tests for the state→text/tooltip mapping in `src/status-bar.test.ts`; extend the existing real-Obsidian Playwright suite (`e2e/search.e2e.ts`) with one assertion that the status-bar item exists and reaches the "done" state after indexing. Reason: renders only in Electron, so the e2e is the only proof it paints.

## HUMAN decides

❓ **Q1** - **What does the icon show when idle but NOT fully indexed?**
Cases: embed deferred until first search (cold model), images waiting for OCR from a desktop, health degraded/recovering. Options:
  (a) A distinct "pending" icon (e.g. clock/pause) with a tooltip explaining why, e.g. `Seeker: 12 notes pending — will index on next search`.
  (b) Keep showing the text counters (`Seeker notes 78/90`) even though nothing is running.
  (c) Show the check mark anyway (simplest, but lies about searchability).

➡️ (a). The check mark should only mean "everything indexable is indexed"; a pending icon is one line of mapping code and keeps the bar honest without hogging space.

❓ **Q2** - **Progress granularity during embedding: files or chunks?**
The pipeline commits per file; the total-files number is known up front, chunk totals are not. Options: (a) files only (`notes 80/90`), (b) files plus chunk count (`notes 80/90 · 1,204 chunks`).

➡️ (a). The ticket's wording is files; chunk counts are engineering detail and the settings card already shows them.

❓ **Q3** - **Scope: include the short single-note fast path (edit one note → re-embed)?**
The bar could flash `notes 0/1` for ~100 ms on every edit. Options: (a) only show counters for bulk work (full reindex, bulk delta ≥ threshold, catch-up drain, OCR pre-pass) and keep the check mark for single-note edits; (b) always reflect any embed.

➡️ (a). Flicker on every keystroke-flush is noise; the existing code already has the bulk/single split (`BULK_DELTA_THRESHOLD` in `src/main.ts`).

</details>

### 2026-09-03 — RESOLVED: interview complete, plan + implementation tickets created
HUMAN answers (round 1): Q1 = (a) distinct pending icon with explanatory tooltip; Q2 = (a) file counts only; Q3 = neither option — show a busy state only after it has persisted for 1 s (anti-flicker delay), so single-note edits never paint and bulk work does. No vetoes on AGENT decisions.

Output:
- Plan (closed): nid_07petn152dbm3y13beujob1z3_e
- Impl 1/3 (open): nid_z8zzhahzmj7ioue0uc6wn4v3h_e — structured index-progress events + settings-tab consumer
- Impl 2/3 (open, profile higher): nid_5di3g372edklzeuxic2karflj_e — status-bar module, 1 s debounce, main.ts wiring, CSS
- Impl 3/3 (open): nid_rpphqlnvtxqlesxfnacwstgez_e — real-Obsidian e2e assertions + docs
Dependency chain: 3/3 → 2/3 → 1/3 → plan.
