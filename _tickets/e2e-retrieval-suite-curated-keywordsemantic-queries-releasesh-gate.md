---
closed_iso: 2026-09-03T19:25:06Z
session_ids: [{"a": "claude", "type": "execution", "id": "bb1ca493-141c-46ab-ac20-6038fd31857b"}, {"a": "claude", "type": "review", "id": "2637615d-85e3-4742-bf59-ce96f50c94b8"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-3
id: nid_qmnacqo5d2tqrhu90olup8ccy_e
title: "E2E retrieval suite: curated keyword/semantic queries + release.sh gate"
status: closed
deps: [nid_dfk1ncuuf6zsfsszu2rzuwdws_e, nid_tthbuk08rra4lyenl50t6de1c_e]
links: []
created_iso: 2026-09-03T18:17:12Z
status_updated_iso: 2026-09-03T19:25:06Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval]
---

Part 3 of 3 of plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e (read it first). Depends on the suite from ticket 2 (`e2e/retrieval.e2e.test.ts`, `e2e/harness/run.mjs`, `docs/e2e-retrieval.md`). This ticket: the human-readable must-pass queries, and wiring the suite as a release gate.

## Curated queries
- `e2e/datasets/cqadupstack-android/curated-queries.json`: ~10 entries `{ id, kind: "keyword" | "semantic", text, expectDocId, maxRank, rationale }`. Hand-write them by READING the committed corpus notes (`e2e/datasets/cqadupstack-android/corpus/*.md`):
  - keyword (5): a short natural query containing a rare exact term or phrase that appears in exactly one note (device model, app name, error string, command) -> `maxRank: 1`. Verify uniqueness with grep before committing; put the grep evidence in `rationale`.
  - semantic (5): a paraphrase of one note's question with NO content-word overlap with that note's title/body (check with a quick script or by hand; state it in `rationale`) -> `maxRank: 3`.
  - Query text must pass the same inline-filter rule as the dataset queries (no `-word`, `[k:v]`, `#tag`, `tag:`/`path:`/`after:`/`before:`); extend the ticket-1 pin test to cover curated-queries.json with the real `parseQuery` and to check every `expectDocId` has a corpus file.
  - Do NOT fabricate expected docs or tune the queries until they pass by trial; if a reasonable query fails, that is a finding: keep it out, and open a ticket describing the miss (with the top-5 result and signals) rather than lowering the bar. Commit at least 3 keyword + 3 semantic passing queries; if you cannot reach that with honest queries, stop and open a `need-human` ticket with the misses instead of shipping a thinner file silently.
- Extend the runner/page so the curated queries run in the same session as the aggregate queries (one index pass; they are just more queries at the default denseWeight). Extend `e2e/retrieval.e2e.test.ts`: one `it` per curated query (name = `[kind] text`), asserting rank(expectDocId) <= maxRank. Failure message prints the query, the expected doc title, and the actual top-5 (doc id, title, score, dense/bm25 signals) so the miss is diagnosable without re-running.
- Runtime: ~10 extra query embeds (~3 s). Confirm the total stays <= 60 s in the container; note the number in docs/e2e-retrieval.md.

## Release gate
- `release.sh` `verify_basics()`: add a step `E2E retrieval gate` running `npm run test:e2e` after Build. Before it, fail loudly with a plain-language message when no Chromium can be resolved: mirror scripts/bench.mjs `printLaunchInfo` (`resolveChromiumPath() ?? chromium.executablePath()` from playwright-core, then `existsSync`) and tell the user to run `npm run bench:setup`. Keep release.sh bash simple; a tiny node one-liner importing from bench/harness is acceptable for the Chromium check. Note in the release.sh header comment that the gate needs network on its first run (model download into .bench-cache/).
- Update `docs/e2e-retrieval.md` (curated section, release gate) and the root CLAUDE.md line for `release.sh`.
- Add a `change_log` entry for the whole e2e suite (plan + 3 tickets) when done, and open a `need-human`-tagged ticket proposing a CI job in .github/workflows/ci.yml (actions/cache for .bench-cache + apt chromium) once the suite has been stable for a while.

## Acceptance
- `npm run test:e2e` green in the container with all committed curated queries passing; `npm test`/typecheck/build green; `./release.sh --help` still works (do not cut a release).

---

## Resolution (2026-09-03)

Done. All acceptance criteria met: `npm run test:e2e` green (12 passed / 1 skipped, ~34 s), `npm test` (1375 passed), `npm run typecheck`, `npm run build` all green; `./release.sh --help` works.

### Curated queries — `e2e/datasets/cqadupstack-android/curated-queries.json`
10 entries `{ id, kind, text, expectDocId, maxRank, rationale }`: **5 keyword** (rare exact term unique to one note, grep-verified, `maxRank: 1`) + **5 semantic** (paraphrase with ZERO content-word overlap with the target note's title+body, `maxRank: 3`).
- keyword: zipalign(29843), SSHelper(42358), link2sd(35701), magnetometer(43205), Iconia A500(14413).
- semantic: recover-deleted-SMS(5414), find-phone-at-home(2603), phone-RAM(50076), QR-install(4972), benchmark(9950).
- Overlap for semantic queries was verified with a throwaway stemmed+stopworded script (`.tmp/overlap.py`, gitignored) and the reasoning recorded in each `rationale`. Ids are non-numeric so they never collide with the numeric aggregate ids in the per-query result map.

**Honesty note (no tuning):** I pre-registered 8 keyword + 8 semantic honest candidates, ran the real stack ONCE, and committed the passers (all 8 keyword + 7/8 semantic passed) trimmed to the ticket's 5+5. The ONE reasonable miss — semantic "driving directions that need no internet connection" → note 1624, which landed at rank #6 because near-duplicate note 56687 "Offline maps & routs" legitimately outranks it on the pure dense signal — was kept OUT and filed as ticket **nid_ijete79awhl83gioovjhb4quk_e** (with top-5 + signals), not tuned to pass.

### Wiring (one index pass)
- `e2e/harness/run.mjs` `readQueries()` now concatenates `queries.json` + `curated-queries.json` so curated queries ride the SAME index pass at the default `denseWeight` (~10 extra query embeds, ~3 s).
- `e2e/retrieval.e2e.test.ts`: added `describe('curated must-pass queries')` with one `it` per query (name `[kind] text`) asserting `rank(expectDocId) <= maxRank` on the hybrid channel; failure message prints the query, expected note title, and actual top-5 (id, title, score, dense/bm25 signals). New `RankingSignals` interface (subset of `ScoredChunk['ranking_signals']`).
- `e2e/datasets/cqadupstack-android.test.ts` (pin test, runs in plain `npm test`): extended with a `curated-queries.json` block — every query survives the real `parseQuery` unchanged, every `expectDocId` has a corpus file, kind ∈ {keyword,semantic}, ids unique + non-numeric, keyword `maxRank`==1, ≥3 of each kind (`MIN_CURATED_PER_KIND`).

### Release gate — `release.sh`
- `verify_basics()` runs `npm run test:e2e` as a new **E2E retrieval gate** step after Build.
- Before it, a tiny `node --input-type=module` one-liner resolves Chromium exactly like `scripts/bench.mjs` `printLaunchInfo` (`resolveChromiumPath() ?? chromium.executablePath()`, then `existsSync`) and, on miss, `die`s with a plain message pointing at `npm run bench:setup`.
- Header comment updated to note the gate needs network on its first run (model download into `.bench-cache/`).

### Docs / follow-ups
- `docs/e2e-retrieval.md`: new "Curated must-pass queries" + "Release gate" sections; budget line updated to 40 queries. Root `CLAUDE.md`: `test:e2e` + `release.sh` lines updated.
- `change_log` entry `gm9bmln9wuntjokevk4ejibug` added for the whole suite (plan + 3 tickets).
- CI follow-up (need-human): **nid_xe2pqp2t53ge36dnyc4zjkrmb_e** proposes a `.github/workflows/ci.yml` job (actions/cache for `.bench-cache` + apt/bundled chromium) once the suite has been stable a while.

## Notes

**2026-09-03T19:28:37Z**

__READY_AS_IS__: Reviewed diff + ran it all green — pin test 14 passed, typecheck clean, full e2e 12 passed/1 skipped in 34.5s (all 10 curated queries pass, under 60s budget), release.sh --help + node Chromium check work. Metrics correctly ignore curated queries (iterate gold keys, non-numeric curated ids avoid collision); no ranking-tuning, honest miss filed + linked. No bugs found; changed nothing.
