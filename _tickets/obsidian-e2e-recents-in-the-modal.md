---
id: nid_efzom8fbm1yy7vzd8aqvdzafu_e
title: "Obsidian e2e: recents in the modal"
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

Follow-up from the Obsidian e2e plan (deps). Extend e2e/search.e2e.ts (or a sibling *.e2e.ts) using the harness in e2e/obsidianHarness.ts; keep one Obsidian launch per spec, DOM-state assertions, no imports from src/ (they pull in obsidian). After running two queries and reopening the modal with an empty field, .seeker-recents lists them (src/search-modal.ts ~742, src/recents.ts); the remove control drops one.

