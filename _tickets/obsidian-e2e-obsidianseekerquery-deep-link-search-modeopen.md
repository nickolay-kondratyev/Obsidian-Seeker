---
id: nid_lueflkttrdedaaloim4qvxdgk_e
title: "Obsidian e2e: obsidian://seeker?query= deep link (search + mode=open)"
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

Follow-up from the Obsidian e2e plan (deps). Extend e2e/search.e2e.ts (or a sibling *.e2e.ts) using the harness in e2e/obsidianHarness.ts; keep one Obsidian launch per spec, DOM-state assertions, no imports from src/ (they pull in obsidian). Trigger the protocol handler registered in src/main.ts (registerObsidianProtocolHandler('seeker')) e.g. via window.open('obsidian://seeker?query=...') or app.openWithDefaultApp equivalents inside page.evaluate: default mode opens the modal pre-filled and running; mode=open opens the top hit's note without a modal.

