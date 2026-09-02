---
closed_iso: 2026-09-02T19:59:05Z
session_ids: [{"a": "claude", "type": "execution", "id": "b20cb016-fc35-4bec-8bd3-27525772dfc8"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_vztkzvtq3fd6quowv9pw3zsce_e
title: "Create CLAUDE.md top level and sub levels."
status: closed
deps: []
links: []
created_iso: 2026-09-02T19:54:10Z
status_updated_iso: 2026-09-02T19:59:05Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

Create CLAUDE.md at the top level and sub-folder CLAUDE.md 

I am presuming we will want to use SUB-agents spawned to explore folders and to create CLAUDE.md per sub-folder. 

I am also presuming that we will likely want to the final CLAUDE.md created after we have analyzed the sub-folders. 

CLAUDE.md that we created should be CONCISE and SUCCINCT. They should also favor to push the information to lower level claude.mds and finally to push information into comments where appropriate. 

## Resolution (2026-09-02)

Created via two parallel Explore sub-agents (src architecture; test infrastructure), then wrote top-down:

- `CLAUDE.md` (root) — commands, layout, and 3 global cross-file invariants (analyzer-hash refit from `esbuild.config.mjs`, index version identity via `src/identity.ts` aggregating per-module version constants, popout-window `activeWindow` convention).
- `src/CLAUDE.md` — layer map (orchestration / indexing / storage / retrieval / UI / diagnostics) with key files, plus conventions: colocated tests, cross-module invariant tests without same-named source, coordinator write lock, worker-vs-iframe split.
- `src/test-harness/CLAUDE.md` — when to use the tier-2 scenario harness vs unit tests.
- `src/test-stubs/CLAUDE.md` — the `obsidian` stub alias gotcha (missing export = silent `undefined`) and `test-setup.mts`.

Deliberately NOT given CLAUDE.md files (info pushed up/down instead): `src/fixtures/` (one line in `src/CLAUDE.md`), `tests/` (one line in root).

Observations for possible follow-ups (not in scope): `self_work.test.fast.sh` and `self_work.test.full.sh` are byte-identical (`npm run test`); `tests/relevance-cases.json` is referenced by nothing in the repo.