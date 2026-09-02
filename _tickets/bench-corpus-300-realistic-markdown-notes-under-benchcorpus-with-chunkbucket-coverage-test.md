---
id: nid_9xdumruajy1oru6nlz6g3y1ag_e
title: "Bench corpus: ~300 realistic Markdown notes under bench/corpus/ with chunk/bucket coverage test"
status: open
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e]
links: []
created_iso: 2026-09-02T22:54:54Z
status_updated_iso: 2026-09-02T22:54:54Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, corpus]
---

Part of plan nid_mw6gkmuurjhiqva4rr6doenul_e. First bench ticket; the harness ticket depends on it.

## What
Commit a deterministic, realistic vault under `bench/corpus/` (git-tracked, NOT under `src/`). Generate it ONCE with a sub-agent writing realistic prose (no dictionary-word soup), then commit. ~300 notes, target ~1.5k-3k chunks.

## Composition (human-approved)
- Mix: meeting notes, project docs, journal entries, how-tos, reading notes, a few long articles; a handful with code fences, tables and callouts (these are ATOMS in `src/atoms.ts` and exercise structure-aware splitting in `src/token-budget.ts`).
- Realistic headings (H1-H3), frontmatter (tags/aliases/dates) on roughly a third, `[[wikilinks]]` between notes.
- Length spread so EVERY index seq bucket is hit: `SEQ_BUCKETS = [32, 48, 64, 96, 128, 192, 256, 384, 512]` (`src/iframe-runner.ts` line 62). Most notes = several short-to-medium heading sections (one chunk each, no overlap); ~10% with a single section > 512 tokens so the split + 15% within-section overlap path runs (`OVERLAP_FRACTION` in `src/token-budget.ts` ~line 160).
- Chunking reference: read the "Pipeline at a glance" header comment in `src/chunker.ts`.
- No personal data, no real names/emails; English only (the model is multilingual but keep the corpus simple).

## Also
- `bench/corpus/README.md`: what it is, how it was generated, that it is frozen (changing it invalidates baselines in `docs/perf-bench.md`).
- Coverage test `bench/corpus.test.ts` (runs in the default `npm run test`, fast, Node): walk the folder, run `chunkMarkdown` (see `src/chunker.ts` exports) and assert file count within [280, 330] and that the char-estimated token histogram (`CHARS_PER_TOKEN_EST` = 4.5 in `src/token-budget.ts`; exact counts need the model, so estimate is fine here) covers every bucket with >= 5 chunks, and >= 20 notes have a section estimated > 512 tokens. One assert per test.
- `BENCH_FILES=N` semantics (used by the harness): the first N files in sorted path order; name files with a zero-padded numeric prefix so the first 60-80 files alone still cover every bucket (interleave lengths).

## Files
- `bench/corpus/**.md`, `bench/corpus/README.md`, `bench/corpus.test.ts`; `vitest.config.mts` may need `include` widened to `bench/**/*.test.ts` (check current default include; keep `src/**` behaviour unchanged).

## Acceptance Criteria

bench/corpus committed with ~300 notes; corpus.test.ts passes in npm run test and pins bucket coverage; README explains freeze rule.

