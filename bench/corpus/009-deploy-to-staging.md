---
tags: [devops, howto, ledgerline]
created: 2026-01-22
status: active
---

Quick reference for pushing a build to the staging environment. Written after the third time someone asked Kofi this in standup instead of checking here first.

## before you start

Make sure your branch is rebased on `main` and that [[024-ci-pipeline-setup]] shows a green run. Staging deploys only from `main`, never from a feature branch directly, no exceptions even for quick fixes, since staging is what the whole team trusts for demos and testing.

## step 1: trigger the workflow

Push to `main` or manually trigger the `deploy-staging` GitHub Actions workflow from the Actions tab.

## step 2: watch the build

The workflow builds `packages/api` and `packages/web` separately, runs `pnpm typecheck` and `pnpm test` for both, then builds Docker images and pushes them to the registry. Takes about six minutes end to end on a clean cache, closer to nine if the Docker layer cache misses for some reason, which happens more often than anyone would like right after a dependency bump touches the lockfile.

## step 3: migrations run automatically

`node-pg-migrate up` runs as a pre-deploy step against the staging database before the new API image goes live, so schema changes always land before the code that depends on them.

## step 4: smoke test

Once the deploy finishes, hit `https://staging.example.com/health` and confirm it returns `200`. Then log into the staging UI with the shared test account and create one throwaway invoice end to end — customer, line item, send — to confirm nothing broke silently.

## rollback

If the smoke test fails, re-run the workflow against the previous commit's Docker tag.

## gotchas and notifying the team

Migrations that add a `NOT NULL` column without a default will fail against staging's existing rows, same as production, so test locally first, per [[014-writing-db-migrations]]. Another gotcha: staging shares payment sandbox credentials with everyone else, so a real webhook during testing can confuse someone else's debugging.

Post in the team channel once staging is green, especially before a demo — see [[011-client-demo-prep]]. Include the commit hash and a one-line summary of what changed, since "deployed" alone tells nobody what shipped.
