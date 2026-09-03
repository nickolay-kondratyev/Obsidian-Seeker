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

Follow-up from the Obsidian e2e plan (deps). Extend e2e/search.e2e.ts (or a sibling *.e2e.ts) using the harness in e2e/obsidianHarness.ts; keep one Obsidian launch per spec, DOM-state assertions, no imports from src/ (they pull in obsidian). Cover the protocol handler registered in `src/main.ts` (~603, `registerObsidianProtocolHandler('seeker', …)`): `obsidian://seeker?query=<urlencoded>` opens the modal pre-filled and running (`openSearchModal(query)`); `&mode=open` opens the top hit's note with no modal (`openTopResult(query)`). The `mode` param is the discriminator (`action` is reserved by Obsidian).

How to fire the URL is NOT settled — decide at implementation, in this order of preference, and record the choice with a WHY comment:
1. Obsidian's own dispatch: from `page.evaluate`, Obsidian exposes the protocol handler map on `app` (undocumented; inspect `app` in the devtools console for the handler registry, e.g. by searching `Object.keys(app)` / the `registerObsidianProtocolHandler` implementation in `app.js`). Calling that dispatcher with `{ action: 'seeker', query: '…', mode: 'open' }` exercises the real parsing path.
2. Second-instance argv: spawn the same Obsidian binary again with the URL as its only argument (`<obsidian> 'obsidian://seeker?query=…'`); Electron forwards it to the running instance's `open-url`/second-instance handler. Needs the same `--user-data-dir` so the running instance is found; slower and less deterministic.
3. Last resort: call `plugin.openSearchModal(query)` / `plugin.openTopResult(query)` directly — this only tests the plugin methods, not the URL wiring, so say so in the test name.
Assertions: default mode → `.seeker-modal` visible and `.seeker-edit` text equals the query, then results as in the basic suite; `mode=open` with the `kw-zipalign` query → `app.workspace.getActiveFile()?.path === '29843.md'` and no `.seeker-modal` in the DOM.

