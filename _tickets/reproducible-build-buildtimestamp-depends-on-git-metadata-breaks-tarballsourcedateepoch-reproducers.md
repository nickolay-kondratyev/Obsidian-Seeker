---
id: nid_om110880r2jcx5813qzj68p85_e
title: "Reproducible build: buildTimestamp depends on git metadata (breaks tarball/SOURCE_DATE_EPOCH reproducers)"
status: open
deps: []
links: [nid_3268emfa9r35w3bbzcg0fw9ss_e]
created_iso: 2026-09-04T01:04:36Z
status_updated_iso: 2026-09-04T01:04:36Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [decide, need-human]
---

Follow-up to nid_3268emfa9r35w3bbzcg0fw9ss_e, which made the production build deterministic.

## Context
`/home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/esbuild.config.mjs` `resolveBuildTimestamp()` now derives the bundle's `__BUILD_TS__` (→ `src/iframe-runner.ts` InitEntry.buildTimestamp) from, in order:
1. `SOURCE_DATE_EPOCH` env var,
2. the HEAD commit committer date via `git log -1 --format=%cI`,
3. the sentinel `'unknown'`.

The CI release build (`.github/workflows/release.yml`: `actions/checkout` → has `.git`, does NOT set SOURCE_DATE_EPOCH) therefore stamps the git committer date (branch 2).

## The residual risk
Obsidian's reproducibility check (the one that raised "Build output does not match the released main.js artifact") rebuilds from the tagged source and compares bytes. The fix only reproduces the CI bytes if the reproducer's environment ALSO lands on branch 2 with the SAME committer date. Two plausible ways it does NOT:
- Reproducer builds from a GitHub source TARBALL/zip (no `.git`) → `git log` fails → timestamp becomes `'unknown'` ≠ the CI git date → MISMATCH, flag persists.
- Reproducer sets `SOURCE_DATE_EPOCH` (the Obsidian forum reproducible-builds thread explicitly recommends this) to a value != the git committer date → MISMATCH.

The guard `scripts/build-reproducible.test.mjs` only asserts INTRA-environment determinism (two builds in the same repo/env), so it cannot catch this cross-environment divergence — it gives false confidence about the actual Obsidian check.

## What a human needs to decide
How does Obsidian's checker actually fetch source (git clone at tag vs. tarball) and does it set SOURCE_DATE_EPOCH? Then pick a robust strategy, e.g.:
- Publish/pin an explicit SOURCE_DATE_EPOCH at release time (release.sh / release.yml) so any reproducer can set the same value; or
- Derive the stamp from a COMMITTED file that survives tarball extraction (no reliance on `.git`); or
- Drop the embedded build timestamp entirely (diagnostic-only value) and rely on `__PLUGIN_VERSION__`.

Until resolved, the next release may STILL be flagged despite this branch.

