---
closed_iso: 2026-09-03T19:24:19Z
session_ids: [{"a": "claude", "type": "execution", "id": "d4abebe2-db8a-4ee2-a673-e5fbe9b5d86c"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_wu8lcu5vhox1ivpy8v6tz8al2_e
title: "release.sh does not create release on github"
status: closed
deps: []
links: []
created_iso: 2026-09-03T18:41:23Z
status_updated_iso: 2026-09-03T19:24:19Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

We want a tagged commit to create a release on github.

Right now when we pushed a tagged commit we get 
`
No releases published
Create a new release
`

view in the releases section.

---

## Resolution status (2026-09-03, agent session) — NEEDS HUMAN

### Root cause 1 (fixed in code): the release TAG was never pushed
`origin` had **zero tags**. `npm version` (run by `release.sh`) tags locally; a plain
`git push` pushes the commit but NOT the tag, and only the tag push fires
`.github/workflows/release.yml`. Both `1.1.4` and `1.1.5` existed only locally.

What was built (commit `71bf72b` on this branch):
- `release.sh` preflight now refuses to cut a new version while the current
  `package.json` version's tag exists locally but not on origin, printing the
  exact `git push origin <tag>` fix. `--push` pushes branch+tag with one
  `git push --atomic`. The "not pushed" message spells out the gotcha.
- Test: `scripts/release-preflight.test.mjs` (runs a real temp clone + bare
  origin through the script; part of `npm test`).
- Header comment of `.github/workflows/release.yml` and the `release.sh` line
  in `CLAUDE.md` updated.
- Full suite + typecheck green.

Done as part of this ticket: `git push origin 1.1.5` (tag is now on origin).
Left alone: local tag `1.1.4` (commit 8111074, on main) is still unpushed —
**decide** whether to publish it (`git push origin 1.1.4`) or drop it
(`git tag -d 1.1.4`). Note the new preflight only checks the *current* version's
tag, so 1.1.4 will not block future releases.

### Root cause 2 (needs human): GitHub Actions never runs on this repo
After pushing tag 1.1.5 and polling the public API for 3 minutes: no workflow
run, no release. Worse, `actions/runs` reports **total_count 0 for the repo's
whole history**, although `ci.yml` (on: push to main) has existed since
2026-09-02 and main has been pushed many times since. Both workflows are
registered and `state: active`, the repo is public, and pushes come from a
normal user SSH key (`github-user-23`), which does trigger workflows.
So Actions is being blocked at the repo/account level, not by the workflow files.

Please check, in this order:
1. Repo → Settings → Actions → General → "Actions permissions": must not be
   "Disable actions". Also "Workflow permissions": Read and write is needed for
   `gh release create` (the workflow also declares `permissions: contents: write`).
2. Account (nickolay-kondratyev) → Settings → Actions → General: Actions not
   disabled for all repositories.
3. Account → Billing: a failed payment / spending-limit lock disables Actions.
4. Actions tab of the repo: any banner such as "Actions is disabled" / "requires approval".

Once Actions runs, re-fire the release for 1.1.5 (a tag push that already
happened will not re-trigger):
```
git push --delete origin 1.1.5 && git push origin 1.1.5
```
Then confirm at https://github.com/nickolay-kondratyev/Obsidian-Seeker/releases
that `1.1.5` has `main.js`, `manifest.json`, `styles.css` attached.

I could not inspect settings myself: `gh` is not authenticated in this sandbox
and repo settings are not visible on the unauthenticated API.



---

## Closed (2026-09-03, second agent session)

- **Root cause 2 resolved**: the repo is a GitHub *fork*; GitHub disables all
  workflows on forks until an owner enables them in the Actions tab. Human did
  so; CI ran on the next push.
- Tags 1.1.6 and 1.1.8 pushed to origin -> Release workflow ran green -> both
  releases published with main.js / manifest.json / styles.css.
- Recurrence root cause: `./release.sh` without `--push` only tagged locally,
  and later plain `git push` never sends tags. Fix: **push is now the default**
  (atomic branch+tag), `--no-push` is the opt-out. Covered by
  `scripts/release-preflight.test.mjs` end-to-end against a bare origin.
- Leftovers, harmless: local-only tags 1.1.4 and 1.1.7 (never published,
  superseded); origin tag 1.1.5 has no release (superseded by 1.1.6). Delete or
  ignore at will; preflight only checks the current version's tag.
