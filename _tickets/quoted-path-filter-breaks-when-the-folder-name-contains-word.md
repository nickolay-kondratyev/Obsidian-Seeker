---
id: nid_k4d00kla5xlyswcy9oe99kkq0_e
title: "Quoted path: filter breaks when the folder name contains ' -word'"
status: open
deps: []
links: []
created_iso: 2026-10-20T19:06:51Z
status_updated_iso: 2026-10-20T19:06:51Z
type: bug
priority: 3
assignee: nickolaykondratyev
tags: []
---

`parseQuery` in `src/query-parser.ts` strips bare-word `-term` negations before it binds quoted `path:"…"` tokens. So a folder like `Notes/My -Draft` becomes the broken path `"Notes/My` plus an exclusion of `draft`, and the search returns nothing. `Q1 - Plan` is unaffected (the dash is followed by a space). This hits typed filters, the folder autosuggest (`src/suggest.ts`) and the **Search in current folder** command (`folderScopeQuery`), whose doc comment lists it as a known limit.

Fix: make negation extraction skip text inside quoted operator values. Add a round-trip test through `parseQuery` + `compileMatcher` in `src/query-parser.test.ts`, then remove the limit note from `folderScopeQuery`.

