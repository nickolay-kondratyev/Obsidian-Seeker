---
id: nid_rgqel5ujgnx0rv1pjachgmyfb_e
title: "Date filters independent of Recency + relative after:7d / last-X-days presets"
status: in_progress
deps: []
links: []
created_iso: 2026-10-30T16:55:25Z
status_updated_iso: 2026-10-30T16:55:28Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [search, filters, ui]
---

Branch date-filter-last-x-days (worktree .worktree/date-filter-last-x-days).

1. Recency ranking ON by default (Default stage eps 0.04 / HL 180) + settingsRev 12 migration (src/types.ts migrateSettings) moving undefined/0 eps to 0.04.
2. Decouple after:/before: from Recency: src/search.ts buildFilterContext always supplies dateField; src/query-field.ts drops dateFiltersEnabled gating; src/settings-tab.ts date-field dropdown stays enabled.
3. Relative values after:7d / 2w / 3m / 1y resolved to absolute local YYYY-MM-DD via one pure helper with injected nowMs (src/query-parser.ts); pill commit converts; presets last 7/30/90 days.
4. Tests: unit (query-parser, query-field, settings-migrate), tier-2 scenario (src/test-harness/scenario.ts) with real mtimes, real-Obsidian e2e (e2e/search.e2e.ts) with fs.utimesSync mtimes.
5. Docs: README.md filter table, docs/e2e-obsidian.md coverage list.

