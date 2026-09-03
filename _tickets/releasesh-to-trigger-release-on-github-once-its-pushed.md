---
closed_iso: 2026-09-03T18:31:04Z
session_ids: [{"a": "claude", "type": "execution", "id": "88e75f3c-0a58-49d0-9252-8b0cf5940dfe"}, {"a": "claude", "type": "review", "id": "5b0a1733-b5b0-4299-8049-c0f8843fa873"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_inervi8kj0ujgwncglysvkhok_e
title: "release.sh to trigger release on github once its pushed"
status: closed
deps: []
links: []
created_iso: 2026-09-03T18:27:28Z
status_updated_iso: 2026-09-03T18:31:04Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

Right now after we ran ./release.sh and pushed the tagged commit there is no release assets appearing in Github

We would like to have the assets appars in https://github.com/nickolay-kondratyev/Obsidian-Seeker once the tagged commit is pushed.

---

## Resolution

The tag-triggered pipeline (`.github/workflows/release.yml`) *does* fire on a tag
push — the tag `1.1.4` carries the workflow, and `on: push: tags: ["*"]` is
correct. Two things in the workflow explained why no assets appeared, and both
were fixed:

1. **Draft-only release.** `gh release create --draft` only ever created a
   *draft* release. Drafts don't publicly appear and BRAT/Obsidian's installer
   can't fetch them. The ticket asks for assets to appear automatically once the
   tag is pushed, so `--draft` was dropped → the release now publishes
   immediately. (`--draft` documented inline for anyone who later wants a
   review-before-publish flow.)
2. **Provenance step could kill the job before publishing.**
   `actions/attest-build-provenance@v2` ran as a hard step. If it fails — most
   notably because artifact attestation requires a public repo (or a plan that
   allows it), so it fails on a private repo — the job died *before*
   `gh release create` ever ran, leaving the tag with no assets at all. Marked
   the attest step `continue-on-error: true` so provenance is best-effort and
   never blocks the release. This is the likely root cause if the repo was
   private when the earlier release was pushed.

Also updated the now-stale "draft" wording in `release.sh` (header comment +
post-push message) and `CLAUDE.md`.

Files touched: `.github/workflows/release.yml`, `release.sh`, `CLAUDE.md`.
Change log: `Release workflow publishes assets on tag push (was draft-only)`.

Note: could not exercise the workflow end-to-end from here (no `gh`/GitHub
auth in this environment); the fix is by inspection of the workflow. Next real
release (`./release.sh --push`) will confirm — the Release should appear
published with `main.js`/`manifest.json`/`styles.css` attached even if the
attest step reports a non-fatal failure.
