---
closed_iso: 2026-09-03T17:26:42Z
session_ids: [{"a": "claude", "type": "execution", "id": "fb048c5f-fdca-4c0f-abd1-968c82ff1a52"}, {"a": "claude", "type": "review", "id": "28e6a091-be1d-4e0e-8b86-69f3bf44c775"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-2
id: nid_4qv8zdtdmhvc3uugdupcgrccg_e
title: "Make the repo ready to be obsidian published"
status: closed
deps: []
links: []
created_iso: 2026-09-03T17:19:04Z
status_updated_iso: 2026-09-03T17:26:42Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

Make the repo ready to be published with Obsidian.

Find the best practices and have './release.sh' script.

I am thinking that we will want to trigger asset creation on github workflow whenever there is a tag added and `./release.sh` would be responsible for:
- Running tests to make sure basics are in place.
- Revving the patch version
- Committing
- Adding the tag with for new version.

---

## Resolution

Most of the publish plumbing already existed; the ticket's ask was the missing
`./release.sh`. What was found already in place and reused:

- `.github/workflows/release.yml` — fires on any pushed tag, rebuilds and
  drafts a GitHub Release with `main.js` / `manifest.json` / `styles.css` as
  individual assets (+ build-provenance attestation). This is the "trigger
  asset creation on tag" the ticket wanted.
- `.npmrc` sets `tag-version-prefix=""` so `npm version` tags the **bare**
  version (e.g. `1.1.4`, no `v`) — Obsidian's installer and BRAT require the tag
  to match `manifest.json` "version" exactly.
- `version-bump.mjs` (wired to the npm `version` script) keeps
  `manifest.json` + `versions.json` in lockstep with `package.json` on bump.
- `manifest.json`, `versions.json`, `LICENSE` (MIT), `README.md` — all present
  and valid for community-plugin submission.

What was built:

- **`./release.sh [patch|minor|major] [--push]`** (default `patch`). Order:
  1. Preflight — run from repo root, on `main` (override with
     `RELEASE_ALLOW_BRANCH=1`), clean working tree, not behind `origin/main`.
  2. Basics — `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
  3. Bump — `npm version <part>`: rewrites manifest + versions.json, commits,
     tags the bare version.
  4. Push — with `--push`, pushes branch + tag (firing `release.yml`);
     otherwise stops after tagging and prints the exact push command.
  Includes `--help`; unknown args exit 2.
- Documented the release flow in `CLAUDE.md` (Commands section).

Verified: `bash -n` clean; `--help`, unknown-arg, off-`main`, and dirty-tree
guards exercised; full `npm ci && typecheck && test` run green (1370 passed).
The heavy bump/tag path was not executed (it would create a real tag) — it is a
thin wrapper over `npm version`, which the repo already relies on.

Next reader: to actually cut a release, checkout `main`, then
`./release.sh patch --push`.