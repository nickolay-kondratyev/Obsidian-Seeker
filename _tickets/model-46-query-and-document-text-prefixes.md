---
id: nid_raiqgnyuva8ex6rt6p2ldtyya_e
title: "Model 4/6: query and document text prefixes"
status: open
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e, nid_mny8ao7h45fiyiplclnl8ad68_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T20:25:50Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [model]
---

Model 4/6 — Query and document text prefixes. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md ("Runtime" → Prefixes). Depends on 1/6.

WHY: e5-family models need 'query: ' / 'passage: ', nomic needs 'search_query: ' / 'search_document: '. Without them those models silently underperform (the failure the 2026-06 model-choice removal warned about). The shipped granite model uses empty prefixes → byte-identical embed input to today for the default (assert this in a test).

CONTEXT (inventory): src/token-budget.ts embedInput(c: Chunk) (L173-188) builds `title\n\ncontent[\n\ndenseSuffix]`, collapses padding and hard-caps at TOKEN_BUDGET * MAX_COLLAPSED_CHARS_PER_TOKEN; it is the single source for BOTH token counting (L212 inside enforceTokenBudget) and embedding. Call sites in src/search.ts: L1242 (index-side embed batching), L2156 (drift re-embed comparison), L3165 and L3204 (carry-over vector cache keyed by embedInput text). Query embed: src/search.ts search() L3462 `this.embedder.embed(cleanDenseText(cleanedQuery))`. ModelSpec (src/model-registry.ts, after 1/6) carries queryPrefix and docPrefix; docPrefix is part of the identity key (modelKeyFor), queryPrefix is not.

CHANGES
1. src/token-budget.ts: embedInput(c, docPrefix: string) prepends docPrefix verbatim (no added separator; users type the trailing space themselves, e.g. 'passage: '); enforceTokenBudget(chunks, countTokens, budget, docPrefix) threads it so the prefix's tokens count against the budget like denseSuffix does (see the L250 comment on suffix reservation; reserve the prefix's token count the same way in splitChunk so a split never overflows).
2. src/search.ts: every embedInput / enforceTokenBudget call passes activeSpec().docPrefix; the carry-over cache keys (L3165/L3204) naturally change with the prefix — fine (a prefix change is an identity change → full reindex anyway). Query: `this.embedder.embed(activeSpec().queryPrefix + cleanDenseText(cleanedQuery))`.
3. Tests: src/token-budget.test.ts — embedInput with '' equals the pre-change output for the fixture corpus (pin BEFORE changing); with 'passage: ' the output starts with it and the budget still holds (count includes the prefix). A search-side test that the query embed receives the prefix (use the existing test-harness / embedder stub pattern in src/test-harness/ — read its CLAUDE.md).

ACCEPTANCE: typecheck + `npm run test` green; change_log entry.

