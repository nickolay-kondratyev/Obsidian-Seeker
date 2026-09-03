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

Part 3 of 3 of plan ticket nid_07petn152dbm3y13beujob1z3_e (requires part 2's status-bar item with `.seeker-statusbar` + `data-state`). Goal: prove in a REAL Obsidian that the status-bar item paints, and document it.

## Background
- Real-Obsidian Playwright suite: `e2e/search.e2e.ts` (serial, one Obsidian instance), harness `e2e/obsidianHarness.ts`, config `e2e/playwright.config.ts`, docs `docs/e2e-obsidian.md`. Run with `npm run test:e2e:obsidian` (auto-downloads Obsidian on Linux; needs the container's docker/podman notes only if you run it inside a sandbox — see `docs/e2e-obsidian.md`). Before touching it, load `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md`.
- Test "c. full reindex indexes the whole corpus" (`e2e/search.e2e.ts` ~118) runs `plugin.runFullReindex({ skipConfirm:true, onProgress })` inside `page.evaluate` and awaits it. The ~150-note corpus takes many seconds, far more than the status bar's 1 s show delay (`BUSY_SHOW_DELAY_MS` in `src/status-bar.ts`).
- Selectors are duplicated into the spec on purpose (importing `src/*` would pull `obsidian` into node) — follow the `SEEKER_DOM` convention at the top of the spec and add `statusBar: ".seeker-statusbar"`.

## Deliverables
1. In `e2e/search.e2e.ts`:
   - New test "b2. status bar shows pending before the first index" (or fold into the existing empty-index test): before any reindex, `.seeker-statusbar` exists and its `data-state` is NOT `complete` (fresh vault = nothing indexed; the expected value is `pending` or `complete` per part 2's `refreshStatusBar` rules — assert the exact value part 2 produces for an empty, never-indexed vault, and if that turns out to be `complete`, STOP and file a `decide` ticket: an unindexed vault must not show the check mark).
   - In test c: kick the reindex WITHOUT awaiting inside a first `page.evaluate` (store the promise on `window.__seekerReindex`), then `expect.poll` that `.seeker-statusbar` text matches `/^Seeker notes \d+\/\d+/` and `data-state === 'busy'`; then await the stored promise in a second `page.evaluate` and keep the existing assertions; finally `expect.poll` `data-state === 'complete'` and `aria-label === 'Seeker: index up to date'`.
2. Run `npm run test:e2e:obsidian` to green; paste the summary line into the ticket resolution. If the environment cannot run it, do NOT mark done — record exactly what failed.
3. Docs: `docs/e2e-obsidian.md` (one line on the status-bar assertions); confirm `README.md` already describes the status-bar item (part 2) and adjust wording if the observed behaviour differs.
4. Record with `change_log`.

