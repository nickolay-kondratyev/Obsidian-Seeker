---
id: nid_rpphqlnvtxqlesxfnacwstgez_e
title: "Status bar 3/3: real-Obsidian e2e assertions for the status-bar item + docs"
status: open
deps: [nid_5di3g372edklzeuxic2karflj_e]
links: []
created_iso: 2026-09-03T23:18:06Z
status_updated_iso: 2026-09-03T23:18:06Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ui, e2e]
---

Part 3 of 3 of plan ticket nid_07petn152dbm3y13beujob1z3_e (requires part 2's status-bar item with `.seeker-statusbar`, `data-state` and `data-reason`). Goal: prove in a REAL Obsidian that the status-bar item paints, and document it.

## Background
- Real-Obsidian Playwright suite: `e2e/search.e2e.ts` (serial, one Obsidian instance), harness `e2e/obsidianHarness.ts`, config `e2e/playwright.config.ts`, docs `docs/e2e-obsidian.md`. Run with `npm run test:e2e:obsidian` (auto-downloads Obsidian on Linux; inside the podman sandbox first read `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md` and the sandbox notes it points to).
- Test "b. unindexed vault shows the onboarding panel without typing" (~110) proves the vault starts with an EMPTY index. Test "c. full reindex indexes the whole corpus" (~118) runs `plugin.runFullReindex({ skipConfirm:true, onProgress })` inside a single awaited `page.evaluate`. The ~150-note corpus takes many seconds, far more than the status bar's 1 s show delay (`BUSY_SHOW_DELAY_MS` in `src/status-bar.ts`). On this fresh Obsidian the model loads INSIDE that call first, so the item shows `Seeker loading model…` (`data-state="loading-model"`) before `Seeker notes N/M` (`data-state="busy"`).
- Selectors are duplicated into the spec on purpose (importing `src/*` would pull `obsidian` into node) — follow the `SEEKER_DOM` convention at the top of the spec and add `statusBar: ".seeker-statusbar"`.
- Expected values come from part 2's `refreshStatusBar` priority list: fresh vault → `data-state="pending"`, `data-reason="no-index"`; after a successful full reindex of a notes-only corpus → `data-state="complete"`, `aria-label="Seeker: index up to date"`.

## Deliverables
1. In `e2e/search.e2e.ts`:
   - New test "b2. status bar shows the not-indexed pending state before the first index" (after test b, before c): `.seeker-statusbar` exists, `data-state === 'pending'`, `data-reason === 'no-index'` (use `expect.poll` — `refreshIndexEmpty` is async and runs at the end of `onload`). If the observed value differs, do NOT loosen the assertion: find out which `refreshStatusBar` rule fired and fix part 2's wiring or, if the rule itself is debatable, file a `decide` ticket.
   - In test c: kick the reindex WITHOUT awaiting inside a first `page.evaluate` (store the promise on `window.__seekerReindex`, returning nothing), then `expect.poll` (timeout = the existing `REINDEX_TEST_TIMEOUT_MS`) that `data-state === 'busy'` AND the text matches `/^Seeker notes \d+\/\d+/`; then await the stored promise in a second `page.evaluate` and keep the existing assertions unchanged; finally `expect.poll` `data-state === 'complete'` and `aria-label === 'Seeker: index up to date'`. If the final state is `pending`/`deferred` instead, investigate whether `runFullReindex` leaves `catchUpPending` set (grep `catchUpPending = true` in `src/main.ts`) rather than adjusting the assertion.
   - Test e (Enter opens the top result) and the curated-query tests must stay untouched.
2. Run `npm run test:e2e:obsidian` to green (redirect output to `.tmp/`); paste the summary line into the ticket resolution. If the environment cannot run it, do NOT mark done — record exactly what failed.
3. Docs: `docs/e2e-obsidian.md` (one line on the status-bar assertions); confirm `README.md` already describes the status-bar item (part 2) and adjust wording if the observed behaviour differs.
4. Record with `change_log`.
