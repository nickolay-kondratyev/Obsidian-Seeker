---
closed_iso: 2026-09-02T23:49:33Z
session_ids: [{"a": "claude", "type": "execution", "id": "37ccb7f8-831a-469b-8605-bb527e35cd50"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_9xdumruajy1oru6nlz6g3y1ag_e
title: "Bench corpus: ~300 realistic Markdown notes under bench/corpus/ with chunk/bucket coverage test"
status: closed
deps: [nid_mw6gkmuurjhiqva4rr6doenul_e]
links: []
created_iso: 2026-09-02T22:54:54Z
status_updated_iso: 2026-09-02T23:49:33Z
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
- Coverage test `bench/corpus.test.ts` (runs in the default `npm run test`, fast, Node): walk the folder, chunk each note with `new MarkdownChunker().chunkContent(content, path)` (`src/chunker.ts` ~line 181, returns `Chunk[]`; there is no `chunkMarkdown` function), build each chunk's embed text with `embedInput(chunk)` (`src/token-budget.ts`; that is the exact string the index path embeds, title prefix included) and bucket it with `selectBucket(embedInput(chunk).length)` (`src/iframe-runner.ts` ~line 89 — the char-estimate twin of the token-exact `selectIndexBucket`; exact counts need the model tokenizer, so the estimate is fine here). Assert: file count within [280, 330]; every bucket has >= 5 chunks; >= 20 notes contain a section whose char-estimated token count (chars / 4.5) is > 512. One assert per test.
- `BENCH_FILES=N` semantics (used by the harness): the first N files in sorted path order; name files with a zero-padded numeric prefix so the first 60-80 files alone still cover every bucket (interleave lengths).

## Files
- `bench/corpus/**.md`, `bench/corpus/README.md`, `bench/corpus.test.ts`. No `vitest.config.mts` change: vitest's default include (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) already picks up `bench/**/*.test.ts`. Corollary: anything under `bench/` named `*.test.ts` that must NOT run in `npm run test` has to be gated with `describe.skipIf(!process.env.BENCH)`.

## Acceptance Criteria

bench/corpus committed with ~300 notes; corpus.test.ts passes in npm run test and pins bucket coverage; README explains freeze rule.


## Resolution (2026-09-02)

Done in commit `99dc9be` on this branch.

**What was built**
- `bench/corpus/001-*.md` .. `300-*.md`: 300 notes, ten themed sub-vaults of 30 (Ledgerline invoicing team, bungalow renovation, learning Rust, cycling club, cooking/fermentation, urban-planning thesis, photography studio, personal finance/FIRE, multi-day hiking, "Tidewatch" board game). Zero-padded prefix + kebab slug.
- `bench/corpus/README.md`: freeze rule, composition, measured shape, how generated.
- `bench/corpus.test.ts`: four one-assert tests (file count 280-330; every `SEQ_BUCKETS` rung >= 5 chunks; >= 20 notes with a section > 512 est. tokens; every rung present in the first 70 files, the `BENCH_FILES` contract). Runs in `npm run test` (vitest default include), ~10 ms.

**Measured** (real `MarkdownChunker.chunkContent` + `embedInput` + `selectBucket`): 300 files, 101 with frontmatter, 1644 chunks, 46 oversize notes; per bucket 32..512 = 101/185/146/330/189/179/155/178/181; first 70 files hit every bucket.

**How it was generated (so the next reader does not have to rediscover)**
- A throwaway Python script (`.tmp/gen_recipes.py`, git-ignored, intentionally not kept) produced a deterministic recipe per note: type cycles over 10 kinds, frontmatter on `i % 3 == 0`, a code fence / table / callout roughly every 7th note, and one of ten section-shape templates keyed on `i % 10` with per-section word ranges tuned to the bucket ladder at 4.5 chars/token (32-bucket sections ~12-16 words ... 512-bucket ~320-370 words; shape 4 has ONE 560-700-word section -> 30 oversize notes by design, 46 in practice because long sections in other shapes also overshoot).
- Ten Sonnet sub-agents (one per theme) wrote the prose from a shared brief (realistic content, fictional first names only, no emails/phones/addresses, `[[NNN-slug]]` wikilinks within their block). Word ranges were verified per section by the agents with ad-hoc scripts.
- Privacy grep after generation: no emails, no phone patterns, only `example.com` / `localhost` / `sh.rustup.rs` URLs, no CRLF, no HTML.

**Assumptions made without a human**
- Prose written by Sonnet sub-agents (cheaper/faster than the session model); quality checked by grep + spot reads, acceptable for a throughput bench.
- The recipe script was not committed: the corpus is frozen, and re-running it would produce different text, so the script would only invite regeneration.
- Oversize is measured on `embedInput(chunk).length / 4.5 > 512` per chunk emitted by `chunkContent` (which emits whole sections; the token-exact split happens later in `enforceTokenBudget`).

**Gotcha for future agent-written corpora**: the writer sub-agents tended to spawn their OWN sub-agents and then stop "waiting for them", producing gaps and duplicate numeric prefixes. Fix was an explicit "do NOT spawn sub-agents, write sequentially" instruction plus a dedupe/gap check by prefix at the end.
