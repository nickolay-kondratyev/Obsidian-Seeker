---
id: nid_v1vtt1ef2cthf4282d4d0zzji_e
title: "Similar notes 1/3: dense-only similarNotes(notePath, mode) on SearchOrchestrator"
status: open
deps: []
links: []
created_iso: 2026-10-27T00:24:54Z
status_updated_iso: 2026-10-27T00:24:54Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_z4vwfvotr3lfmjs4ke2ud6isa_e
tags: [similar-notes, cluster-graph]
---

## Goal
Give the similar-notes panel (epic `nid_z4vwfvotr3lfmjs4ke2ud6isa_e`) one call that returns the notes most similar to a given indexed note, using only stored vectors (no embedder/model load), in either of two user-selectable modes. Also give the panel a way to learn that the index changed so it can refresh.

## Done criteria
- `SearchOrchestrator` exposes a method (suggested: `similarNotes(notePath, mode, topK)`) returning ranked results — one per note, best first, score = cosine — shaped so `src/result-cluster-model.ts` `buildClusterGraph` and `SearchOrchestrator.resultVectors` can consume them directly (each result's `chunk_id` = the candidate note's best-matching chunk).
- Two modes, as a named union type (e.g. `SimilarityMode = 'best-chunk' | 'average'`) exported for the settings/UI ticket:
  - `best-chunk`: every chunk of the source note is scanned separately; a candidate note's score = max cosine over all (source chunk, candidate chunk) pairs.
  - `average`: source chunk vectors are averaged and re-normalized into one query vector; candidate note's score = max cosine of that vector over the candidate's chunks.
- The source note itself never appears in its own results.
- Source note not indexed / no vectors / empty index → empty result (not an exception).
- An index-changed signal the UI can subscribe to (e.g. `onIndexChanged(listener)` fired when the coordinator generation bumps, or a public generation getter) — enough for a view to know "re-query now".
- Unit tests (BDD style, colocated) covering: both modes rank a clearly-closer note first; the two modes can disagree on a constructed case (a multi-topic source note where best-chunk finds a note matching one topic that average ranks lower); self-exclusion; one-result-per-note; not-indexed note → empty. `npm run typecheck` and `npm run test` green.

## Context
- `src/search.ts` `search()` (~:3784) is the reference pipeline; read its S0–S3 header comment. Reusable pieces:
  - resident frame: `private ensureFrame()` (`orderedChunks`, `orderedIds`, `activePacked`, `bytesPerVec`, `residentInt8`/`residentScales`; `residentInt8` is null on mobile / over budget → fall back to `store.getEmbeddingsByIds`).
  - stage-1: `binaryCandidatesAsync` (`src/binary-scorer.ts`, off-thread on desktop, sync fallback) and `buildSelectionMask` (tombstones; can also exclude the source note's rows).
  - stage-2: `cosineScores` (`src/ranker.ts`, unit-normalized inputs), `alignCandidate` (`src/search.ts`).
  - S3 dedup: `dedupByPath` (`src/search.ts`, keeps first chunk per `note_path` of a score-sorted pool).
- Source note vectors: `IndexStore.getFileRecord(notePath).chunk_ids` (`src/index-store.ts`) → `getEmbeddingsByIds`.
- Generation counter: `IndexCoordinator.generation` (`src/index-coordinator.ts`), bumped via `bumpGeneration()` in `src/search.ts`. `coord` is private today.
- `src/search.ts` is huge; prefer putting the pure, Obsidian-free scoring/aggregation (per-note max across scans, averaging) in a new small module (e.g. `src/similar-notes.ts` + test) and keep the orchestrator method a thin wiring layer.

## Constraints
- Dense-only: no BM25, recency, or title boost (those are query-text signals).
- Must stay ranking-identical between the binary worker and its sync fallback (existing invariant, `src/CLAUDE.md` §Conventions).
- `best-chunk` cost scales with the source note's chunk count. Cap the number of source chunks scanned with a named constant and a comment naming the ceiling (very long notes) and upgrade path. Pick the cap from a measurement or a stated estimate, not a guess.
- Do not change `search()` ranking behavior. If you extract shared helpers out of `search()`, do it in a separate refactor commit.

## Non-goals
- Any UI, settings, or command (ticket 3/3).
- Caching similarity results across calls.
