---
id: nid_qmnacqo5d2tqrhu90olup8ccy_e
title: "E2E retrieval suite: curated keyword/semantic queries + release.sh gate"
status: open
deps: [nid_dfk1ncuuf6zsfsszu2rzuwdws_e, nid_tthbuk08rra4lyenl50t6de1c_e]
links: []
created_iso: 2026-09-03T18:17:12Z
status_updated_iso: 2026-09-03T18:17:12Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval]
---

Part 3 of 3 of plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e (read it first). Depends on the suite from ticket 2 (`e2e/retrieval.e2e.test.ts`, `e2e/harness/run.mjs`, `docs/e2e-retrieval.md`). This ticket: the human-readable must-pass queries, and wiring the suite as a release gate.

## Curated queries
- `e2e/datasets/cqadupstack-android/curated-queries.json`: ~10 entries `{ id, kind: "keyword" | "semantic", text, expectDocId, maxRank, rationale }`. Hand-write them by READING the committed corpus notes (`e2e/datasets/cqadupstack-android/corpus/*.md`):
  - keyword (5): a rare exact term or phrase that appears in exactly one note (device model, app name, error string, command) -> `maxRank: 1`. Verify uniqueness with grep before committing; put the grep evidence in `rationale`.
  - semantic (5): a paraphrase of one note's question with NO content-word overlap with that note's title/body (check with a quick script or by hand; state it in `rationale`) -> `maxRank: 3`.
  - Do NOT fabricate expected docs or tune the queries until they pass by trial; if a reasonable query fails, that is a finding: keep it out, and open a ticket describing the miss (with the top-5 result and signals) rather than lowering the bar.
- Extend the runner/page so the curated queries run in the same session as the aggregate queries (one index pass; they are just more queries at the default denseWeight). Extend `e2e/retrieval.e2e.test.ts`: one `it` per curated query (name = `[kind] text`), asserting rank(expectDocId) <= maxRank. Failure message prints the query, the expected doc title, and the actual top-5 (doc id, title, score, dense/bm25 signals) so the miss is diagnosable without re-running.
- Runtime: ~10 extra query embeds (~3 s). Confirm the total stays <= 60 s in the container; note the number in docs/e2e-retrieval.md.

## Release gate
- `release.sh` `verify_basics()`: add a step `E2E retrieval gate` running `npm run test:e2e` after Build. Before it, fail loudly with a plain-language message when no Chromium can be resolved (reuse `resolveChromiumPath()` logic: /usr/bin/chromium or Playwright's bundled build; tell the user to run `npm run bench:setup`). Keep release.sh bash simple; a tiny node one-liner importing from bench/harness is acceptable for the Chromium check.
- Update `docs/e2e-retrieval.md` (curated section, release gate) and the root CLAUDE.md line for `release.sh`.
- Add a `change_log` entry for the whole e2e suite (plan + 3 tickets) when done, and close the plan ticket's remaining follow-up: open a `need-human`-tagged ticket proposing a CI job (actions/cache for .bench-cache + apt chromium) once the suite has been stable for a while.

## Acceptance
- `npm run test:e2e` green in the container with all curated queries passing; `npm test`/typecheck/build green; `./release.sh --help`/dry path still works (do not cut a release).

