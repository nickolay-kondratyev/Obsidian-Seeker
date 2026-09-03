---
closed_iso: 2026-09-03T21:02:58Z
session_ids: [{"a": "claude", "type": "execution", "id": "77b6e100-effc-4e3b-bb82-2f4b4bdb49b5"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-2
id: nid_q5flwbl6fzfu1eu69tyful8yg_e
title: "Rename test:e2e -> test:e2e:retrieval; add combined test:e2e"
status: closed
deps: [nid_t5n3efu9vt5yk1drwg27q2uog_e]
links: []
created_iso: 2026-09-03T20:40:09Z
status_updated_iso: 2026-09-03T21:02:58Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e]
---

Rename the vitest retrieval gate script and introduce the combined `test:e2e` script. Plan of record: `_tickets/plan-real-obsidian-playwright-e2e-suite-basic-search.md` (nid_t5n3efu9vt5yk1drwg27q2uog_e) — read it first.

## Change
In `package.json`:
- `"test:e2e:retrieval": "E2E=1 vitest run e2e/retrieval.e2e.test.ts"` (the old `test:e2e` body, unchanged).
- `"test:e2e": "npm run test:e2e:retrieval && npm run test:e2e:obsidian"` — `test:e2e:obsidian` does not exist yet; that is expected and is added by the next ticket. Until then `npm run test:e2e` fails at the second half with `Missing script: "test:e2e:obsidian"`; that is acceptable because after this ticket nothing (release.sh, docs, CI) calls the combined script — they all call `test:e2e:retrieval`. The next ticket (nid_yz7qu6wa2w5u2mu6soip6jl1x_e) adds `test:e2e:obsidian`.

Update every reference of the old name to `test:e2e:retrieval` (they all mean the retrieval gate). Found with `grep -rn "test:e2e" --exclude-dir=node_modules --exclude-dir=_tickets --exclude-dir=_change_log .`:
- `CLAUDE.md` lines 7 and 11 (command list + release.sh description).
- `release.sh` header comment (line ~10), comments ~136/147, and the actual call at line ~163: `npm run test:e2e` -> `npm run test:e2e:retrieval`.
- `scripts/release-preflight.test.mjs` line ~54: the stubbed scripts object key `'test:e2e': 'true'` -> `'test:e2e:retrieval': 'true'` (keep the test passing: it drives release.sh through a stubbed clone).
- `docs/e2e-retrieval.md` lines ~27, 28, 46, 116, 127.
- `e2e/retrieval.e2e.test.ts` header comments lines 4-6 and ~224.

## Acceptance
- `npm run test:e2e:retrieval` still runs the retrieval gate (run it once; ~35 s warm in the container).
- `npm test` passes (includes `scripts/release-preflight.test.mjs`).
- `grep -rn 'test:e2e' --exclude-dir=node_modules --exclude-dir=_tickets --exclude-dir=_change_log --exclude-dir=.tmp . | grep -v 'test:e2e:'` shows ONLY the combined script line in `package.json` (and any doc line that describes the combined script). Note: a `\b` after `e2e` would still match `test:e2e:retrieval`, hence the `grep -v`.
- Record with `change_log`.

## Resolution (done)
All edits applied exactly per plan:
- `package.json`: `test:e2e:retrieval` = old retrieval-gate body (unchanged); new
  `test:e2e` = `npm run test:e2e:retrieval && npm run test:e2e:obsidian`
  (`test:e2e:obsidian` intentionally not yet defined — added by
  nid_yz7qu6wa2w5u2mu6soip6jl1x_e; combined script fails at second half until then,
  which is acceptable since nothing calls it yet).
- Renamed every retrieval-gate reference to `test:e2e:retrieval`: `CLAUDE.md`
  (cmd list + release.sh line), `release.sh` (header + comments ~136/147 + the
  actual call, now `npm run test:e2e:retrieval`), `scripts/release-preflight.test.mjs`
  (stubbed scripts key + comment), `docs/e2e-retrieval.md` (all 5 refs),
  `e2e/retrieval.e2e.test.ts` (header usage block + re-pin comment).

Verification (all pass):
- Acceptance grep returns EMPTY output — the combined line itself contains
  `test:e2e:retrieval` so `grep -v 'test:e2e:'` filters it too; no bare `test:e2e`
  references remain anywhere. Cleaner than the "only the combined line" wording anticipated.
- `npm test` — 1443 passed / 19 skipped, incl. `scripts/release-preflight.test.mjs`.
- `npm run test:e2e:retrieval` — passed, ~36 s warm (nDCG@10 0.8990, Recall@10 1.0).
- change_log id `mmw5d0ilarrbul2f1fz0dtdbo`.

