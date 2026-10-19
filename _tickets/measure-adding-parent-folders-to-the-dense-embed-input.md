---
id: nid_5g7vfrbjxmxxalkwl4zfg03f9_e
title: "Measure adding parent folders to the dense embed input"
status: open
deps: []
links: []
created_iso: 2026-10-19T16:12:33Z
status_updated_iso: 2026-10-19T16:12:33Z
type: feature
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [decide]
---

Parent folder names are searchable via BM25 only (the `folders` field in `src/bm25.ts`, `extractFoldersText`). The dense channel embeds `title + content + denseSuffix` (`src/token-budget.ts` embedInput); the title already carries the file basename but not the folders.

Open question: does adding the parent folder chain to the embed input improve retrieval enough to justify a one-time full re-embed of every vault?

Constraints:
- Must NOT go into `title`: BM25 `extractNoteName` and `src/fusion.ts` titleMatchBoost parse the title (first ` > ` segment = note name). Use a dense-only slot like `denseSuffix` (`src/chunker.ts` buildDenseSuffix → embedInput → chunkIdFor).
- Changes every chunk_id → bump `CHUNKER_VERSION` → full re-embed per device.
- Risk: generic folders (Archive, Inbox, date folders) pull unrelated notes together. The `npm run test:e2e:retrieval` corpus is flat, so it cannot measure this.

## Acceptance Criteria

- A/B on the personal eval (with folder-bearing vault) shows nDCG@10 delta for dense+folders vs current.
- Ship only if net-positive; otherwise close with the numbers recorded.

