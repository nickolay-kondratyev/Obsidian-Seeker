---
id: nid_y9a13zw05eqkw360rgvm58a4l_e
title: "e2e e1 fails around midnight: test process and Obsidian disagree on today's date"
status: open
deps: []
links: []
created_iso: 2026-11-21T00:04:30Z
status_updated_iso: 2026-11-21T00:04:30Z
type: bug
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e]
---

Observed while implementing nid_il90ju34g89e14fhf18ms7h28_e: `npm run test:e2e:obsidian` run at ~00:02 with TZ=CST failed test e1 in `e2e/search.e2e.ts`. The "last 7 days" pill showed `2026-11-13` but the test expected `2026-11-14`, because the Playwright test process computed the expected date on one side of midnight while Obsidian computed it on the other (or used a different TZ). Rerun with `TZ=UTC` passed 30/30. Pre-existing, unrelated to the filter-menu change.

Fix: compute the expected date inside Obsidian (`page.evaluate`) so both sides use one clock/TZ, rather than pinning TZ in `scripts/run-e2e-obsidian.sh` (which would hide real TZ bugs). Check other date-relative e2e assertions in `e2e/search.e2e.ts` for the same pattern.

## Acceptance Criteria

- Expected dates in date-relative e2e assertions are computed in the Obsidian renderer, not the test process.
- `npm run test:e2e:obsidian` passes under a non-UTC TZ.

