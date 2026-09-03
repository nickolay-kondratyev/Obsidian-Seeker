---
id: nid_pffuigo6cfoqt5gn71zm19d20_e
title: "release.sh: gate on Obsidian e2e + refuse to run in a container"
status: open
deps: [nid_t5n3efu9vt5yk1drwg27q2uog_e, nid_yz7qu6wa2w5u2mu6soip6jl1x_e]
links: []
created_iso: 2026-09-03T20:40:09Z
status_updated_iso: 2026-09-03T20:40:09Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e, release]
---

Make `release.sh` gate on the real-Obsidian e2e suite and refuse to run inside a container. Read the plan ticket this depends on first (ratified decisions Q2 and Q4).

## Change `release.sh`
1. Container refusal, FIRST thing in the script (before preflight):
   ```bash
   # Same test as the shell helper of the same name; inlined because release.sh
   # must not depend on a profile-only function.
   is_in_container() { [[ -f /.dockerenv || -f /run/.containerenv ]]; }
   if is_in_container; then
     die "release.sh: running inside a container; releases are cut from the host. Nothing done."
   fi
   ```
   Exit code must be non-zero (ratified: a script that did no release must not look successful).
2. New step after the existing "E2E retrieval gate" step: "E2E Obsidian gate" running `npm run test:e2e:obsidian`. On macOS (`uname -s == Darwin`) if `OBSIDIAN_PATH` is unset, default it to `/Applications/Obsidian.app/Contents/MacOS/Obsidian`; if that file does not exist, `die` with a plain message telling the user to install Obsidian or set `OBSIDIAN_PATH`, BEFORE the multi-minute run. On Linux the wrapper auto-downloads.
3. Update the header comment and the `CLAUDE.md` release.sh line (SUCCINCT) and `docs/e2e-retrieval.md` line ~127 ("release.sh runs …").

## Tests
`scripts/release-preflight.test.mjs` drives `release.sh` through a stubbed clone with stubbed npm scripts; extend it:
- add `'test:e2e:obsidian': 'true'` to the stubbed scripts so the happy path still completes;
- add a test that the container refusal exits non-zero with the message when the marker file check is true. The markers are absolute paths (`/.dockerenv`, `/run/.containerenv`), which cannot be faked in a test without root — so make the check overridable for tests via an env var ONLY if it stays obvious, e.g. `RELEASE_CONTAINER_MARKERS="${RELEASE_CONTAINER_MARKERS:-/.dockerenv /run/.containerenv}"` iterated by `is_in_container`, and the test points it at a temp file. Keep the default behaviour identical to the inline two-file check.
- NOTE: the test suite itself runs inside the container, so the happy-path test MUST set `RELEASE_CONTAINER_MARKERS` to a non-existent path, otherwise every existing release-preflight test now fails with the refusal.

## Acceptance
- `npm test` green (release-preflight tests updated).
- Manually: `./release.sh patch --no-push` in the container exits non-zero with the refusal message and touches nothing (`git status` clean, no tag).
- Record with `change_log`.

