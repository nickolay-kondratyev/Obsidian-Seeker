---
id: nid_4wklzxci3244xy0dv1knvjc20_e
title: "E2E retrieval dataset: CQADupstack-android subset generator + frozen corpus + pin test"
status: open
deps: [nid_dfk1ncuuf6zsfsszu2rzuwdws_e]
links: []
created_iso: 2026-09-03T18:17:12Z
status_updated_iso: 2026-09-03T18:17:12Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval]
---

Part 1 of 3 of plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e (read it first: goal, decisions, facts). This ticket: the frozen retrieval-quality dataset + its generator + a pin test. No browser/model work here.

## Deliverables
1. `scripts/build-e2e-dataset.mjs` (Node, no new deps; use `fetch`). Idempotent, deterministic (seeded PRNG, e.g. mulberry32 with a named SEED constant). Steps:
   - Download into `.tmp/e2e-dataset/` (git-ignored via `.tmp/`; add `.tmp/` to .gitignore if missing) from `https://huggingface.co/datasets/mteb/cqadupstack-android/resolve/main/`: `corpus.jsonl` (14.6 MB; lines `{"_id","title","text"}`), `queries.jsonl` (699 lines `{"_id","text"}`), `qrels/test.tsv` (header `query-id\tcorpus-id\tscore`, 1,696 rows). Skip download when the file exists.
   - Sample: shuffle the distinct query ids from qrels with the seeded PRNG, take QUERY_COUNT=30; collect ALL their relevant corpus ids; fill with seeded-random distractor docs (not relevant to any chosen query) until TARGET_DOCS=150 total docs. Named constants at top with a WHY comment (1-minute container budget at ~4 chunks/s wasm; see docs/perf-bench.md).
   - Write `e2e/datasets/cqadupstack-android/corpus/<corpus-id>.md` = `# <title>\n\n<text>\n` (no frontmatter, no invented metadata). Write `e2e/datasets/cqadupstack-android/queries.json`: `[{ "id": "<query-id>", "text": "...", "relevant": ["<corpus-id>", ...] }]` sorted by id. Write `e2e/datasets/cqadupstack-android/README.md` (what it is, how generated, FREEZE rule copied in spirit from bench/corpus/README.md: do not edit; regeneration re-pins the e2e baseline) and `LICENSE-DATA.md` (content is StackExchange user contributions, CC BY-SA 4.0; packaged by BEIR (Thakur et al. 2021) and mirrored by MTEB at the URL above; link both; state that this folder is NOT under the repo's MIT license).
   - Wipe the output folder before writing so a regeneration never leaves stale files.
2. package.json script `"build:e2e-dataset": "node scripts/build-e2e-dataset.mjs"`.
3. Pin test `e2e/datasets/cqadupstack-android.test.ts` (runs in plain `npm test`, mirror bench/corpus.test.ts): asserts file count within [120,160], query count 30, every `relevant` id has a corpus file, every corpus file is referenced or is a distractor (i.e. file set == union(relevant) + distractors, no orphans beyond that), and an ESTIMATED chunk count (walk corpus with the real `MarkdownChunker` from src/chunker.ts + `embedInput` from src/token-budget.ts as bench/corpus.test.ts does) <= MAX_ESTIMATED_CHUNKS=170 (WHY: ~4 chunks/s -> ~45 s embed, keeps the 1-min budget; ticket 2 measures the real time and may lower TARGET_DOCS).
4. Top-level `README.md` or `LICENSE`: one line pointing at `e2e/datasets/*/LICENSE-DATA.md` for third-party test data.

## Acceptance
- `npm run build:e2e-dataset` twice produces an identical git diff (deterministic).
- `npm run test` and `npm run typecheck` green.
- Commit the generated dataset (it is meant to be frozen).

