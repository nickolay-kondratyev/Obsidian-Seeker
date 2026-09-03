# e2e retrieval dataset — CQADupstack-android subset (FROZEN)

A seeded-random subset of BEIR **CQADupstack-android** (StackExchange
duplicate-question pairs) used as the ground truth of the retrieval-quality e2e
suite (plan `nid_dfk1ncuuf6zsfsszu2rzuwdws_e`). Everything under this folder is
git-tracked third-party **test data**, not plugin code, and is NOT under the
repo's MIT license — see [`LICENSE-DATA.md`](./LICENSE-DATA.md).

## Freeze rule

**Do not hand-edit, add, remove or rename files here.** The e2e baseline is
measured against exactly this content; any change shifts chunk counts, rankings
and metrics and silently invalidates the pinned baseline. To change it, re-run
the generator (which re-pins the baseline) — never edit by hand. In the spirit of
`bench/corpus/README.md`: treat a regeneration as a new dataset and re-capture
the e2e baseline.

## Layout

- `corpus/<corpus-id>.md` — one note per doc, `# <title>` + body. No
  frontmatter, no invented metadata.
- `queries.json` — `[{ "id", "text", "relevant": ["<corpus-id>", ...] }]`,
  sorted by id, `relevant` sorted.

## How it was generated

`node scripts/build-e2e-dataset.mjs` (`npm run build:e2e-dataset`). It downloads
the mirror's PINNED commit
`e03f271e3f4a75f49787c838a62f671b35bc9004` of
https://huggingface.co/datasets/mteb/cqadupstack-android (`corpus.jsonl`,
`queries.jsonl`, `qrels/test.tsv`) into `.tmp/e2e-dataset/`, then samples with a
seeded PRNG (mulberry32, `SEED` in the script). The script is deterministic and
idempotent: a second run downloads nothing and produces an identical diff.

## Eligibility rules

A query is SKIPPED (never "fixed") when ANY rule fails:

- **<= 5 relevant docs** (`MAX_RELEVANT_PER_QUERY`): the
  150-doc budget cannot hold a query with 20-262 relevant docs.
- **every relevant doc's `title + text` <= 2000 chars**
  (`MAX_DOC_CHARS`, also applied to distractors): at this cap the real chunker
  makes exactly one chunk per note, which the 1-minute budget assumes.
- **query text survives the inline-filter parser unchanged**: `-word`,
  `[k:v]`, `#tag`, `tag:`/`path:`/`after:`/`before:` would be rewritten by
  Seeker's `parseQuery` and are not a fair retrieval test. The pin test
  (`e2e/datasets/cqadupstack-android.test.ts`) re-checks every query with the
  real parser.
- **no relevant doc whose title equals the query text** (case-insensitively): a
  verbatim title match is not a retrieval test.

## The sample

30 eligible queries; all their relevant docs plus seeded-random
distractors up to 150 docs total.
