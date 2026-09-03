---
id: nid_q5flwbl6fzfu1eu69tyful8yg_e
title: "Rename test:e2e -> test:e2e:retrieval; add combined test:e2e"
status: open
deps: [nid_t5n3efu9vt5yk1drwg27q2uog_e]
links: []
created_iso: 2026-09-03T20:40:09Z
status_updated_iso: 2026-09-03T20:40:09Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e]
---

Rename the vitest retrieval gate script and introduce the combined `test:e2e` script. Plan of record: the plan ticket this depends on (read it first).

## Change
In `package.json`:
- `"test:e2e:retrieval": "E2E=1 vitest run e2e/retrieval.e2e.test.ts"` (the old `test:e2e` body, unchanged).
- `"test:e2e": "npm run test:e2e:retrieval && npm run test:e2e:obsidian"` — `test:e2e:obsidian` does not exist yet; that is expected and is added by the next ticket. Until then `npm run test:e2e` fails at the second half; `test:e2e:retrieval` is what CI/release use for now.

Update every reference of the old name to `test:e2e:retrieval` (they all mean the retrieval gate). Found with `grep -rn "test:e2e" --exclude-dir=node_modules --exclude-dir=_tickets --exclude-dir=_change_log .`:
- `CLAUDE.md` lines 7 and 11 (command list + release.sh description).
- `release.sh` header comment (line ~10), comments ~136/147, and the actual call at line ~163: `npm run test:e2e` -> `npm run test:e2e:retrieval`.
- `scripts/release-preflight.test.mjs` line ~54: the stubbed scripts object key `'test:e2e': 'true'` -> `'test:e2e:retrieval': 'true'` (keep the test passing: it drives release.sh through a stubbed clone).
- `docs/e2e-retrieval.md` lines ~27, 28, 46, 116, 127.
- `e2e/retrieval.e2e.test.ts` header comments lines 4-6 and ~224.

## Acceptance
- `npm run test:e2e:retrieval` still runs the retrieval gate (run it once; ~35 s warm in the container).
- `npm test` passes (includes `scripts/release-preflight.test.mjs`).
- `grep -rn '"test:e2e"\|run test:e2e\b' --exclude-dir=node_modules .` shows only the combined script and docs that describe the combined script.
- Record with `change_log`.

