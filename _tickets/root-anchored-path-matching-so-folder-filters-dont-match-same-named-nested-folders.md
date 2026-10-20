---
id: nid_2yfjkgbi0axy1o03wqkeki4ub_e
title: "Root-anchored path: matching so folder filters don't match same-named nested folders"
status: open
deps: []
links: []
created_iso: 2026-10-20T19:06:51Z
status_updated_iso: 2026-10-20T19:06:51Z
type: bug
priority: 3
assignee: nickolaykondratyev
tags: [decide]
---

`path:` globs in `src/query-parser.ts` (`compileMatcher`) also try a `*/pattern` suffix fallback, so `path:"Projects/*"` also matches `Archive/Projects/x.md`. This affects every folder filter: the ones users type, the folder autosuggest (`src/suggest.ts` emits `path:"Folder/*"`), and the **Search in current folder** command (`folderScopeQuery` in `src/query-parser.ts`, wired in `src/main.ts`). note_path is always vault-relative, so the fallback is a leftover from the Python backend port.

Decide: drop the fallback (behavior change for typed `path:Sub/*` that relied on matching anywhere), or keep it for typed filters and add a root-anchored form the command/autosuggest emit. Also consider making bare `path:Folder` match the folder contents (currently matches nothing; pinned by the test "no-wildcard pattern matches nothing (documented fnmatch quirk)" in `src/query-parser.test.ts`).

