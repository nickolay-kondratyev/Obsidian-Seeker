# How We Review Pull Requests

Four people, no dedicated reviewer role, so this doc exists to keep reviews consistent rather than dependent on who happens to pick it up that day.

## Before requesting review

Run `pnpm test` and `pnpm typecheck` locally first. A red CI pipeline wastes a reviewer's time reading a diff that isn't ready, and it's an easy check to skip entirely when rushing to get something out the door.

## Keep PRs small

One logical change per PR. Split refactors from behavior changes wherever reasonably possible.

## What reviewers check first

Start with the PR description, not the diff. Does it explain why, not just what? If thin, ask for context before reading code, since understanding intent first makes spotting a wrong approach faster than discovering it three files in. For money math or invoice transitions, per [[022-testing-strategy]], confirm a regression test landed in the same PR, not a promised follow-up.

## Tone in comments

Ask questions rather than issue commands. "What happens if this is null?" beats "add a null check," almost every time we've noticed.

## Approving vs requesting changes

Approve with comments for nitpicks that shouldn't block merge — the author can take them or leave them. Request changes only for real correctness issues, security concerns, or missing tests on money-handling code, not stylistic preferences the author is free to disagree with reasonably.

## Merging

Author merges once approved and CI is green, not the reviewer. Squash merge always.

## A note on speed

None of this should turn into a bottleneck. If a PR sits unreviewed past one business day, ping the author's assigned reviewer directly rather than waiting silently and assuming someone else will pick it up eventually, since with only four of us that assumption fails more often than it should. We've found a same-day review norm, loosely enforced but genuinely valued, keeps momentum without needing anything more formal like assigned rotations or SLA tracking, which felt like overkill for a team this size.
