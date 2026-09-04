---
closed_iso: 2026-09-04T01:00:12Z
session_ids: [{"a": "claude", "type": "execution", "id": "9c5da249-a265-4b03-b617-8d134b3d72f3"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_3268emfa9r35w3bbzcg0fw9ss_e
title: "issue flagged by obsidian"
status: closed
deps: []
links: []
created_iso: 2026-09-04T00:55:28Z
status_updated_iso: 2026-09-04T01:00:12Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

"Build output does not match the released main.js artifact
This may indicate the release asset was modified after building, built with different dependency versions, or built with a different Node version. Releases should be built directly from source via CI/CD with a committed lockfile.
main.js"
""

## Resolution

**Root cause:** the build was non-reproducible. `esbuild.config.mjs` stamped a
wall-clock `new Date().toISOString()` into the bundle via `__BUILD_TS__`
(→ `iframe-runner.ts` `IframeInit.buildTimestamp`, the diagnostic report's
per-init build stamp). Every rebuild of the same commit produced a different
`main.js`, so the published release asset could never be reproduced from source
— exactly what Obsidian's release check flags. Verified: two back-to-back
production builds differed only in that one embedded timestamp string.

The CI release path (`.github/workflows/release.yml`: `npm ci && npm run build`,
committed `package-lock.json`, Node 22) was already correct; the artifact was
never modified after building. Determinism was the sole gap.

**Fix (`esbuild.config.mjs`):** `__BUILD_TS__` now derives from committed source
instead of the wall clock, via `resolveBuildTimestamp()`:
1. `SOURCE_DATE_EPOCH` (reproducible-builds standard) when set,
2. else the HEAD commit's committer date (`git log -1 --format=%cI`), which is
   fixed in the commit object — identical in the CI release build and in any
   clone reproducing the same tag,
3. else the stable sentinel `'unknown'` (no git / source tarball) — never the
   wall clock.
Normalized to a UTC `Z` instant so local timezone can't leak in. No workflow
change needed: `actions/checkout` gives CI git, so branch 2 applies and matches
a reproducer's build byte-for-byte.

**Guard:** `scripts/build-reproducible.test.mjs` runs two production builds and
asserts byte-identical `main.js` (in the normal `npm test` suite). Also noted as
a global invariant in `CLAUDE.md`.

**Verification:** `npm run typecheck` clean; `npm test` 1609 passed / 19 skipped;
two manual `node esbuild.config.mjs production` runs now produce identical
`main.js`, stamped with the HEAD committer date.

Next release cut from `main` will publish a `main.js` that reproduces from the
tagged source, clearing the flag.