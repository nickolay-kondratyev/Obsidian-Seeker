---
session_ids: [{"a": "claude", "type": "execution", "id": "315edcbf-50db-406a-945e-35463a4be84e"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-2
id: nid_pffuigo6cfoqt5gn71zm19d20_e
title: "release.sh: gate on Obsidian e2e + refuse to run in a container"
status: in_progress
deps: [nid_t5n3efu9vt5yk1drwg27q2uog_e, nid_yz7qu6wa2w5u2mu6soip6jl1x_e]
links: []
created_iso: 2026-09-03T20:40:09Z
status_updated_iso: 2026-09-03T21:15:44Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e, release]
---

Make `release.sh` gate on the real-Obsidian e2e suite and refuse to run inside a container. Plan of record: `_tickets/plan-real-obsidian-playwright-e2e-suite-basic-search.md` (nid_t5n3efu9vt5yk1drwg27q2uog_e), ratified decisions Q2/Q4 — read it first. The suite itself (`npm run test:e2e:obsidian`, `scripts/run-e2e-obsidian.sh`) comes from the ticket this depends on.

## Facts (verified 2026-09-03)
- `release.sh` defines helpers `step`/`die` (~64–68) AFTER `parse_args`; `main()` (~198) calls `parse_args` → `preflight` → `verify_basics` → `bump_and_tag` → `finish`. `die` prints `release.sh: <msg>` to stderr and exits 1.
- `verify_basics` (~122) ends with the "E2E retrieval gate" step, whose Chromium precheck is guarded by `[[ -f bench/harness/run.mjs ]]` so that the stubbed clone in `scripts/release-preflight.test.mjs` (no `bench/` tree) falls straight through to a stubbed npm script. Reuse exactly that guard pattern for the new precheck.
- `scripts/release-preflight.test.mjs` copies `release.sh` into a throwaway clone with a `package.json` whose scripts are all `'true'` (line ~54), and runs it via `runRelease(cwd, ...args)` (line ~27) with `env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }`. The suite RUNS INSIDE THE DEV CONTAINER (`/run/.containerenv` exists there).

## Change `release.sh`
1. Container refusal. Add next to `die`:
   ```bash
   # Releases are cut from the host, never from the dev container (no Obsidian
   # display path, not the release author's git identity). Same marker files the
   # shell helper `is_in_container` checks; inlined because release.sh must not
   # depend on a profile-only function. RELEASE_CONTAINER_MARKERS exists ONLY so
   # scripts/release-preflight.test.mjs — which itself runs in the container —
   # can point the check at a file that does not exist.
   is_in_container() {
     local marker
     for marker in ${RELEASE_CONTAINER_MARKERS:-/.dockerenv /run/.containerenv}; do
       [[ -f "${marker}" ]] && return 0
     done
     return 1
   }
   refuse_in_container() {
     if is_in_container; then
       die "running inside a container; releases are cut from the host. Nothing done."
     fi
   }
   ```
   Call `refuse_in_container` in `main()` right AFTER `parse_args "$@"` (so `--help` still works in the container) and BEFORE `preflight`. It must exit non-zero (ratified: a script that did no release must not look successful) — `die` already does.
2. New step at the END of `verify_basics`, after `npm run test:e2e:retrieval`:
   ```bash
   step "E2E Obsidian gate"
   # macOS has no auto-download (scripts/setup-obsidian-bin.sh is Linux-only), so
   # default OBSIDIAN_PATH to the standard install and fail BEFORE the multi-minute
   # run if it is absent. Guarded like the Chromium precheck above: the stubbed
   # clone in scripts/release-preflight.test.mjs has no scripts/ tree and must fall
   # through to its stubbed `npm run test:e2e:obsidian`.
   if [[ -f scripts/run-e2e-obsidian.sh && "$(uname -s)" == "Darwin" ]]; then
     export OBSIDIAN_PATH="${OBSIDIAN_PATH:-/Applications/Obsidian.app/Contents/MacOS/Obsidian}"
     if [[ ! -x "${OBSIDIAN_PATH}" ]]; then
       die "E2E Obsidian gate needs Obsidian at [${OBSIDIAN_PATH}]. Install Obsidian, or set OBSIDIAN_PATH to its binary, then re-run."
     fi
   fi
   npm run test:e2e:obsidian
   ```
   On Linux hosts the wrapper auto-downloads the pinned Obsidian; nothing to add.
3. Docs: update the `release.sh` header comment (step 2 list: "then the E2E retrieval gate and the E2E Obsidian gate"; mention the container refusal and the macOS `OBSIDIAN_PATH` default), the `CLAUDE.md` `release.sh` line (SUCCINCT), and `docs/e2e-retrieval.md` ~127 ("`release.sh` runs …" — now both gates).

## Tests — `scripts/release-preflight.test.mjs`
- Change the helper to `runRelease(cwd, args = [], envOverrides = {})` and pass `RELEASE_CONTAINER_MARKERS: join(root, 'no-such-marker')` in its env by DEFAULT (otherwise every existing test now fails with the refusal, because the suite runs in the container). Update the three existing call sites.
- Add `'test:e2e:obsidian': 'true'` to the stubbed scripts object so the happy path still completes.
- Add a test `refuses to run inside a container (exit non-zero, nothing done)`: write an empty marker file under `root`, run with `envOverrides = { RELEASE_CONTAINER_MARKERS: <that file> }`, expect `status` 1, `stderr` to contain `inside a container`, and neither the clone nor origin to have the `NEXT_VERSION` tag. Place it OUTSIDE the "once the current version tag is on origin" block — the refusal must fire before any git check.
- Also assert in that test that `--help` still prints usage (status 0) with the same env, since the refusal comes after `parse_args`.

## Acceptance
- `npm test` green (release-preflight tests updated; run `npx vitest run scripts/release-preflight.test.mjs` explicitly too).
- Manually in the container: `./release.sh patch --no-push` exits 1 with the refusal message and touches nothing (`git status` clean, no new tag). `./release.sh --help` still prints usage.
- `bash -n release.sh` passes.
- Record with `change_log`.
