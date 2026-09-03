---
closed_iso: 2026-09-03T20:40:11Z
id: nid_t5n3efu9vt5yk1drwg27q2uog_e
title: "Plan: real-Obsidian Playwright e2e suite (basic search)"
status: closed
deps: []
links: []
created_iso: 2026-09-03T20:40:09Z
status_updated_iso: 2026-09-03T20:40:11Z
type: epic
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e, plan]
---

# Plan: real-Obsidian Playwright e2e suite for Seeker (basic search)

Interview ticket: nid_5zn22onkawouvyt69fp11hjs0_e (decisions ratified by the human 2026-09-03).

## Goal
A release-gate e2e suite that drives a REAL Obsidian (Electron) under Playwright, headless in the dev container (auto-downloads a pinned Obsidian) and on the macOS host via `OBSIDIAN_PATH`, exercising Seeker's basic search flow with the curated queries already committed in `e2e/datasets/cqadupstack-android/curated-queries.json`.

Architecture and the 12 non-negotiable mechanics: `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md` (= `/Users/nkondrat/vintrin-env/config/claude/ai_input/deep/obsidian-how-to-setup-e2e-test.md`). Reference files to copy: `~/.claude/skills/obsidian-add-e2e/references/` (setup-obsidian-bin.sh, run-e2e.sh, obsidianHarness.ts, playwright.config.ts, example.e2e.ts, tsconfig.e2e.json).

## Ratified decisions
- Q1 naming: `test:e2e` (currently the vitest retrieval gate) becomes `test:e2e:retrieval`; new `test:e2e:obsidian`; `test:e2e` = `npm run test:e2e:retrieval && npm run test:e2e:obsidian` (sequential).
- Q2 release: `release.sh` gates on the Obsidian suite too (macOS default `OBSIDIAN_PATH=/Applications/Obsidian.app/Contents/MacOS/Obsidian`, fail loudly if absent) AND refuses to run inside a container: inline `is_in_container() { [[ -f /.dockerenv || -f /run/.containerenv ]]; }`, print a plain message, exit NON-zero.
- Q3 scope: basic tests only (a-e below). Everything else = follow-up tickets with `status: follow-up`.
- Runner: `@playwright/test` (add devDependency, same 1.62.x line as the installed `playwright-core`), CDP attach, never `_electron.launch`.
- Obsidian pinned at 1.12.7 (= `manifest.json` minAppVersion); `OBSIDIAN_VERSION` env overrides.
- Fixtures: vault assembled per run into `.tmp/e2e/vault` from `e2e/datasets/cqadupstack-android/corpus/*.md` + the built plugin (`main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/seeker/`). No `.dev-vault/`, no second copy of notes in git.
- Expectations: the spec reads `curated-queries.json` (id, text, expectDocId, maxRank); the note title = first line of `corpus/<expectDocId>.md` with the leading `# ` stripped; asserted on the modal's rendered `.seeker-result-title` rows.
- Persistent `--user-data-dir` at `.tmp/e2e/userdata` so the ~100 MB model + transformers.js CDN download happens once. `obsidian.json` and the window-size file are re-seeded on EVERY launch; the vault copy is fresh per run; the suite always runs an explicit full reindex (nukes IndexedDB) so stale index state cannot leak.
- Backend under headless (`--disable-gpu`) is wasm; not asserted. Budget target: <= 3 min warm.
- Not part of `npm test`.

## Basic test list (one serial spec, one Obsidian launch)
a. plugin loads; `app.commands.executeCommandById('seeker:search')` opens the modal (`.seeker-modal` visible, `.seeker-edit` focused);
b. unindexed vault: modal shows the `.seeker-noindex` state ("Your vault isn't indexed yet");
c. `app.plugins.plugins.seeker.runFullReindex({ skipConfirm: true })` resolves true; indexed file count = corpus size;
d. each curated query typed into the modal ranks its expected note title within `maxRank` (10 parametrized cases);
e. Enter on the top result opens that note (`app.workspace.getActiveFile().path`).

## Ticket order (deps)
1. Rename scripts (`test:e2e` -> `test:e2e:retrieval`, add combined `test:e2e`).
2. Obsidian harness + basic search suite (`test:e2e:obsidian`) — depends on 1.
3. `release.sh`: Obsidian gate + container refusal — depends on 2.
Follow-ups (status follow-up): query filters, settings-tab "Build index" click path, recents, `obsidian://seeker?query=` deep link, `.canvas`/`.base` results.

