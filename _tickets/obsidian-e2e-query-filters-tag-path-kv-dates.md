---
id: nid_nse92c0xs982hhwlqzbn73868_e
title: "Obsidian e2e: query filters (#tag, path:, [k:v], dates)"
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

Follow-up from the Obsidian e2e plan (deps). Extend e2e/search.e2e.ts (or a sibling *.e2e.ts) using the harness in e2e/obsidianHarness.ts; keep one Obsidian launch per spec, DOM-state assertions, no imports from src/ (they pull in obsidian). Cover the inline filter syntax parsed by src/query-parser.ts: a #tag query and a path: query must restrict results to matching corpus notes; add tagged/foldered fixture notes to the vault assembly if the corpus has none.

Note: the basic-suite harness (`e2e/obsidianHarness.ts`) deliberately dropped the reference's `extraFixtures` launch option; re-add it here (vault-relative path → content, written after the corpus copy) so tagged/foldered notes can be layered on top of the flat, frontmatter-less corpus. Filter grammar: `src/query-parser.ts`.
