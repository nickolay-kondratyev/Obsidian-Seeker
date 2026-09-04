---
closed_iso: 2026-09-04T00:31:37Z
id: nid_oazps7p8c85iuon6wlcta5lri_e
title: Turn on image OCR support by default
status: closed
deps: []
links: []
created_iso: '2026-09-04T00:29:05Z'
status_updated_iso: 2026-09-04T00:31:37Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker
---
Lets change the default setting to turn on image OCR support.

## Resolution

Flipped the `indexImages` default from OFF to ON. Because the key already ships
with a "new key, no migration: Object.assign backfills" contract, existing
installs that never persisted the toggle fall through to the new ON default,
while anyone who explicitly turned it OFF keeps their choice (no migration
added — respectful default-only flip, same pattern as `showScores`).

Changes:
- `src/types.ts` — `DEFAULT_SETTINGS.indexImages: false → true`; updated the
  field doc comment ("OFF by default (opt-in)" → "ON by default").
- `src/settings-tab.ts` — toggle description "Off by default." → "On by
  default."; section comment "opt-in toggle" → "on-by-default toggle".
- `README.md` — Image OCR section "off by default" → "on by default".
- `docs/e2e-obsidian.md` — step h note "default-off" → "ON by default".
- `src/settings-migrate.test.ts` — added a `indexImages` default-only lock-in
  test (ships ON + left untouched by `migrateSettings`), mirroring
  `indexCanvases`.

Verified: `npm run typecheck` clean; full `npm run test` suite green
(1608 passed / 19 skipped).
