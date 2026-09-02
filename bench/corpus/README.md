# Bench corpus (FROZEN)

~300 realistic Obsidian Markdown notes used as the fixed input of the desktop
indexing-throughput bench (plan `nid_mw6gkmuurjhiqva4rr6doenul_e`, results in
`docs/perf-bench.md`). Everything under this folder is git-tracked test data,
not plugin code.

## Freeze rule

**Do not edit, add, remove or rename notes here.** The bench baselines in
`docs/perf-bench.md` were measured against exactly this content; any change
(even fixing a typo) shifts chunk counts, token lengths and bucket routing and
silently invalidates every recorded baseline. If the corpus must change, treat
it as a new corpus: re-capture all baselines and say so in `docs/perf-bench.md`.

`bench/corpus.test.ts` (runs in `npm run test`) pins the properties the bench
relies on: file count, every index seq bucket populated, enough oversize
sections, and bucket coverage within the first 70 files.

## What is in it

- Ten fictional themed sub-vaults of 30 notes each (files `001`-`030` are a
  small software team, `031`-`060` a home renovation, `061`-`090` learning
  Rust, and so on). Notes link to each other with `[[wikilinks]]`.
- Note types cycle through meeting notes, project docs, journal entries,
  how-tos, reading notes and long articles. Roughly a third carry YAML
  frontmatter (tags, aliases, created, status). Every seventh note or so
  contains a code fence, a pipe table or a callout (the ATOMS in
  `src/atoms.ts`), which exercise structure-aware splitting in
  `src/token-budget.ts`.
- Section lengths follow ten repeating shapes so that every ten consecutive
  files together hit every entry of `SEQ_BUCKETS` (32..512 tokens) and one
  file in ten has a single section well over the 512-token budget, which
  forces the split + within-section overlap path. Because of the numeric
  prefix and this interleaving, `BENCH_FILES=N` (the first N files in sorted
  order) still spans the whole bucket ladder for small N.
- No personal data: fictional people referred to by role or first name only,
  no emails, phone numbers, addresses or real organisations. English only.

## Measured shape (frozen along with the content)

Measured 2026-09-02 with `MarkdownChunker.chunkContent` + `embedInput` +
the char-estimate `selectBucket` (the same path `bench/corpus.test.ts` uses):

| files | frontmatter | chunks | notes with a > 512-token section |
|------:|------------:|-------:|---------------------------------:|
| 300 | 101 | 1644 | 46 |

Chunks per seq bucket (32 / 48 / 64 / 96 / 128 / 192 / 256 / 384 / 512):
101 / 185 / 146 / 330 / 189 / 179 / 155 / 178 / 181. Every bucket is also
populated within the first 70 files.

## How it was generated

Generated once on 2026-09-02. A small Python script produced a deterministic
per-note recipe (type, frontmatter yes/no, required feature, per-section word
ranges tuned to the bucket ladder at ~4.5 chars/token). Ten LLM sub-agents,
one per theme, then wrote the prose for their 30 notes by hand following the
recipes. The recipe script is intentionally not kept: the corpus is a frozen
artifact, and regenerating it would produce different text.
