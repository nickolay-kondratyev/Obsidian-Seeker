---
id: nid_ajrjpvzsa9byeco3plkf64aqj_e
title: "Obsidian e2e: settings-tab 'Build index' button click path"
status: follow-up
deps: [nid_yz7qu6wa2w5u2mu6soip6jl1x_e]
links: []
created_iso: 2026-09-03T20:40:10Z
status_updated_iso: 2026-09-03T20:40:10Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e, follow-up]
---

Follow-up from the Obsidian e2e plan (deps). Extend e2e/search.e2e.ts (or a sibling *.e2e.ts) using the harness in e2e/obsidianHarness.ts; keep one Obsidian launch per spec, DOM-state assertions, no imports from src/ (they pull in obsidian). Drive the real user path instead of runFullReindex(): open Settings -> Seeker, click 'Build index' (src/settings-tab.ts ~line 397), wait for the inline progress to finish, then a search returns results. Requires the seeded 1280x800 window (mechanic 7) for real clicks.

Note: the button's onClick calls `startReindex()` → `plugin.runFullReindex({ skipConfirm: true, onProgress })` (`src/settings-tab.ts` ~399/~429). Open settings via `app.setting.open(); app.setting.openTabById('seeker')` inside `page.evaluate`, then a real `locator.click()` on the button (pointer events are the behavior under test). This is the only basic-scope flow that needs the model on a cold cache after the basic suite has already warmed it, so give it the same 10-minute per-test timeout.
