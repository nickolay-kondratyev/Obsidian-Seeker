---
closed_iso: 2026-09-03T21:32:13Z
session_ids: [{"a": "claude", "type": "execution", "id": "257596a6-c070-4579-b84b-c0bb12e9f8e3"}, {"a": "claude", "type": "review", "id": "5f48fdab-c84c-4b24-a4b6-589ec4259ebd"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_raiqgnyuva8ex6rt6p2ldtyya_e
title: "Model 4/6: query and document text prefixes"
status: closed
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e, nid_mny8ao7h45fiyiplclnl8ad68_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T21:32:13Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [model]
---

Model 4/6 — Query and document text prefixes. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md ("Runtime" → Prefixes). Depends on 1/6.

WHY: e5-family models need 'query: ' / 'passage: ', nomic needs 'search_query: ' / 'search_document: '. Without them those models silently underperform (the failure the 2026-06 model-choice removal warned about). The shipped granite model uses empty prefixes → byte-identical embed input to today for the default (assert this in a test).

CONTEXT (inventory): src/token-budget.ts embedInput(c: Chunk) (L173-188) builds `title\n\ncontent[\n\ndenseSuffix]`, collapses padding and hard-caps at TOKEN_BUDGET * MAX_COLLAPSED_CHARS_PER_TOKEN; it is the single source for BOTH token counting (L212 inside enforceTokenBudget) and embedding. Call sites in src/search.ts: L1242 (index-side embed batching), L2156 (drift re-embed comparison), L3165 and L3204 (carry-over vector cache keyed by embedInput text). Query embed: src/search.ts search() L3462 `this.embedder.embed(cleanDenseText(cleanedQuery))`. ModelSpec (src/model-registry.ts, after 1/6) carries queryPrefix and docPrefix; docPrefix is part of the identity key (modelKeyFor), queryPrefix is not.

CHANGES
1. src/token-budget.ts: embedInput(c, docPrefix: string) prepends docPrefix verbatim (no added separator; users type the trailing space themselves, e.g. 'passage: '); `enforceTokenBudget(chunks, countTokens, docPrefix: string, budget = TOKEN_BUDGET)` — docPrefix goes BEFORE the defaulted budget so no caller has to spell out the default (clean break: fix all 5 callers in src/search.ts L1142, L2718, L2779, L3068, L3198 + tests). Inside splitChunk reserve the prefix like the title/suffix overhead (count `docPrefix + title\n\n` together as the head overhead so the BPE join slack stays in one place) so a split never overflows.
2. src/search.ts: every embedInput / enforceTokenBudget call passes activeSpec().docPrefix; the carry-over cache keys (L3165/L3204) naturally change with the prefix — fine (a prefix change is an identity change → full reindex anyway). Query: `this.embedder.embed(activeSpec().queryPrefix + cleanDenseText(cleanedQuery))`.
3. Tests: src/token-budget.test.ts — embedInput with '' equals the pre-change output for the fixture corpus (pin BEFORE changing); with 'passage: ' the output starts with it and the budget still holds (count includes the prefix). A search-side scenario test that the query embed receives the prefix: src/test-harness/scenario.ts fakeEmbedder() records nothing today — extend the fake with a `lastEmbedText` (or calls array) and build the harness with settings `{ modelOverride: { …, queryPrefix: 'query: ', docPrefix: 'passage: ' } }`; assert the embed text starts with 'query: ' and that indexed chunk inputs start with 'passage: ' (read src/test-harness/CLAUDE.md first).

ACCEPTANCE: typecheck + `npm run test` green; change_log entry.

---

## RESOLUTION (2026-09-03)

Done. `npm run test` green (1519 passed, incl. new prefix tests); typecheck clean
except pre-existing `@playwright/test` module-missing errors in `e2e/` (playwright
not installed in this container — unrelated).

WHAT + WHERE:
- `src/token-budget.ts`
  - `embedInput(c, docPrefix)` prepends `docPrefix` verbatim before `collapsePadding`/cap
    (no separator added — user types the trailing space). Cap now counts the prefix,
    so the prefix rides inside the truncation window as real input.
  - `enforceTokenBudget(chunks, countTokens, docPrefix, budget = TOKEN_BUDGET)` — docPrefix
    BEFORE the defaulted budget. Threads docPrefix to `embedInput` and `splitChunk`.
  - `splitChunk(chunk, originalCount, countTokens, docPrefix, budget)`: head overhead is now
    counted on `` `${docPrefix}${title}\n\n` `` (one place for the BPE join slack), and the
    verify-loop composed input is `` `${docPrefix}${title}\n\n${body}${suffixTail}` `` — so a
    split never overflows with the prefix counted. `chunkIdFor` unchanged (docPrefix is
    constant within an index; it's part of the identity key, so a change → full reindex).
- `src/search.ts`: all 5 `enforceTokenBudget` calls + all 4 `embedInput` sites pass
  `this.activeSpec().docPrefix`; the drift comparison (was L2521) hoists it to one local so
  both sides agree. Query embed (was L3843): `this.activeSpec().queryPrefix + cleanDenseText(cleanedQuery)`.
  S0.5 comment updated.
- `src/test-harness/scenario.ts`: `fakeEmbedder()` now returns a `RecordingEmbedder`
  (`embedCalls` = query `embed()` texts, `embedBatchCalls` = indexed doc texts) so a scenario
  can assert the ACTUAL dispatched bytes. `Scenario.embedder` is typed to it.
- `src/model-prefix.test.ts` (NEW): boots a scenario with a `modelOverride` carrying
  `queryPrefix: 'query: '` / `docPrefix: 'passage: '`, cold-builds, asserts every indexed
  chunk input starts with `passage: ` and the query embed with `query: `.
- `src/token-budget.test.ts`: existing callers updated to the new signatures (docPrefix `''`);
  new `document text prefix` describe pins `''` == pre-change bytes (granite default → no
  reindex on upgrade) and the `passage: ` lead + budget-with-prefix.
- Other callers pass the shipped default's prefix: `src/chunker.test.ts`, `src/index-store-split.test.ts`
  (`''`), `bench/corpus.test.ts` + `e2e/datasets/cqadupstack-android.test.ts` (`ACTIVE_MODEL_SPEC.docPrefix`).

Change_log: `2026-09-03_21-31-51Z.md`.

NEXT-READER NOTE: `docPrefix` ∈ `modelKeyFor` (index identity) but `queryPrefix` is NOT — a
queryPrefix change alone does not invalidate stored vectors (query-side only), which is why
only docPrefix is threaded through the index path.

