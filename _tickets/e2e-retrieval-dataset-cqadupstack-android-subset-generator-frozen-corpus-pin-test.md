---
session_ids: [{"a": "claude", "type": "execution", "id": "836b8f9e-93e3-4565-a15c-a29091e138c8"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-3
id: nid_4wklzxci3244xy0dv1knvjc20_e
title: "E2E retrieval dataset: CQADupstack-android subset generator + frozen corpus + pin test"
status: in_progress
deps: [nid_dfk1ncuuf6zsfsszu2rzuwdws_e]
links: []
created_iso: 2026-09-03T18:17:12Z
status_updated_iso: 2026-09-03T18:37:00Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval]
---

Part 1 of 3 of plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e (read it first: goal, decisions, "Key facts for implementers"). This ticket: the frozen retrieval-quality dataset + its generator + a pin test. No browser/model work here.

## Deliverables
1. `scripts/build-e2e-dataset.mjs` (Node, no new deps; use `fetch`). Idempotent, deterministic (seeded PRNG, e.g. mulberry32 with a named SEED constant). Export the constants below and guard `main()` with the `process.argv[1]` check used in bench/harness/run.mjs, so the pin test can import the constants without triggering a download. Steps:
   - Download into `.tmp/e2e-dataset/` (add `.tmp/` to .gitignore; it is missing today) from the PINNED mirror commit `https://huggingface.co/datasets/mteb/cqadupstack-android/resolve/e03f271e3f4a75f49787c838a62f671b35bc9004/` (WHY the commit and not `main`: byte-identical regeneration years later). Files: `corpus.jsonl` (14.6 MB; lines `{"_id","title","text"}`), `queries.jsonl` (699 lines `{"_id","text"}`), `qrels/test.tsv` (header `query-id\tcorpus-id\tscore`, 1,696 rows, every score is 1). Skip a download when the file exists. `fetch` must follow redirects (default) - the mirror answers with 302/307 to a CDN.
   - Eligible queries (a query is skipped, never "fixed", when any rule fails; each rule is a named constant with a WHY comment):
     - `MAX_RELEVANT_PER_QUERY = 5`: relevant-doc count from qrels <= 5. WHY: one query has 262 relevant docs and several have 20-50; the 150-doc budget cannot hold "all relevant docs" of such a query. 508 of 699 queries have exactly one relevant doc.
     - `MAX_DOC_CHARS = 2000`: every relevant doc's `title + text` <= 2,000 chars (also applied to distractors). WHY: max doc is 27,830 chars; at <= 2,000 the real chunker makes exactly one chunk per note (measured 2026-09-03: 150 docs -> 150 chunks), which is what the 1-minute budget assumes.
     - Query text must survive the plugin's inline-filter parser unchanged. The generator is plain Node so it cannot import src/query-parser.ts; use a CONSERVATIVE regex that rejects any text containing whitespace-or-start followed by `-`, `#`, `tag:`, `path:`, `after:`, `before:`, or any `[`. The pin test (below) is the authoritative check with the real parser. WHY: `-word` is note-level negation and `[k:v]` a frontmatter filter in Seeker; 5 of the 699 queries hit this (e.g. "Battery -life?", "[RPC:S-7:AEC-0]").
     - No relevant doc whose title equals the query text case-insensitively (3 such pairs; a verbatim title match is not a retrieval test).
   - Sample: shuffle the distinct qrels query ids with the seeded PRNG (sort ids first so the shuffle is reproducible regardless of file order), keep eligible ones, take `QUERY_COUNT = 30`; collect ALL their relevant corpus ids; fill with seeded-random distractor docs (not relevant to any chosen query, <= MAX_DOC_CHARS) until `TARGET_DOCS = 150` docs total. Fail loudly (non-zero exit) if the relevant set alone exceeds TARGET_DOCS instead of silently overshooting. WHY 30/150: 1-minute container budget at ~4 chunks/s wasm (docs/perf-bench.md).
   - Write `e2e/datasets/cqadupstack-android/corpus/<corpus-id>.md` = `# <title>\n\n<text>\n` (no frontmatter, no invented metadata; see memory note "no synthetic data to fit schema"). Write `e2e/datasets/cqadupstack-android/queries.json`: `[{ "id": "<query-id>", "text": "...", "relevant": ["<corpus-id>", ...] }]` sorted by id, `relevant` sorted. Write `e2e/datasets/cqadupstack-android/README.md` (what it is, how generated, the eligibility rules, FREEZE rule in the spirit of bench/corpus/README.md: do not edit; regeneration re-pins the e2e baseline) and `LICENSE-DATA.md` (content is StackExchange user contributions, CC BY-SA 4.0; packaged by BEIR (Thakur et al. 2021) and mirrored by MTEB at the URL above; link both; state that this folder is NOT under the repo's MIT license).
   - Wipe the output folder before writing so a regeneration never leaves stale files.
2. package.json script `"build:e2e-dataset": "node scripts/build-e2e-dataset.mjs"`.
3. tsconfig.json `include`: add `"e2e/**/*.ts"` (today only src/ and bench/ are type-checked; without this the pin test and everything ticket 2 adds under e2e/ are invisible to `npm run typecheck`).
4. Pin test `e2e/datasets/cqadupstack-android.test.ts` (runs in plain `npm test`; mirror bench/corpus.test.ts style, GIVEN/WHEN/THEN, one assert per test). Import `QUERY_COUNT`, `TARGET_DOCS`, `MAX_RELEVANT_PER_QUERY` from `scripts/build-e2e-dataset.mjs` (DRY; do not retype the numbers). Assert:
   - corpus file count == TARGET_DOCS; query count == QUERY_COUNT; every file is named `<numeric id>.md` and starts with `# `.
   - every `relevant` id has a corpus file; every query has 1..MAX_RELEVANT_PER_QUERY relevant ids. (Do NOT assert "every file is referenced or a distractor": that is a tautology.)
   - for every query, the REAL `parseQuery(text)` from src/query-parser.ts returns `filters === null` and `cleanedQuery === text`.
   - ESTIMATED chunk count (walk corpus with the real `MarkdownChunker` from src/chunker.ts + `embedInput` from src/token-budget.ts, as bench/corpus.test.ts does) <= `MAX_ESTIMATED_CHUNKS = 170` (WHY: ~4 chunks/s -> ~40 s embed, keeps the 1-min budget; expected value is exactly TARGET_DOCS given MAX_DOC_CHARS; ticket 2 measures the real time and may lower TARGET_DOCS).
5. Top-level `README.md` or `LICENSE`: one line pointing at `e2e/datasets/*/LICENSE-DATA.md` for third-party test data.

## Acceptance
- `npm run build:e2e-dataset` twice produces an identical git diff (deterministic); the second run downloads nothing.
- `npm run test` and `npm run typecheck` green (typecheck now covers e2e/).
- Commit the generated dataset (it is meant to be frozen).
