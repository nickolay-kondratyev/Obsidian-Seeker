---
id: nid_zed3yyg8qjc67kba08rm9tzhv_e
title: "Obsidian e2e: .canvas and .base results"
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

Follow-up from the Obsidian e2e plan (deps). Extend e2e/search.e2e.ts (or a sibling *.e2e.ts) using the harness in e2e/obsidianHarness.ts; keep one Obsidian launch per spec, DOM-state assertions, no imports from src/ (they pull in obsidian). Add one .canvas and one .base fixture to the vault assembly (see src/canvas-extractor.ts, src/base-extractor.ts, docs/canvas-search-plan.md); a query for a card's text returns the canvas result and Enter opens the canvas (src/canvas-open.ts).

