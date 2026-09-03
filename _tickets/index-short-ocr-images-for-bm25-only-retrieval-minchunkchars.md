---
id: nid_yzd46ax0fyhb1zmawx56nt9tc_e
title: "Index short-OCR images for BM25-only retrieval (< minChunkChars)"
status: open
deps: []
links: [nid_bfwwesjlphmieihxc322eqna7_e]
created_iso: 2026-09-03T23:37:14Z
status_updated_iso: 2026-09-03T23:37:14Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [ocr, search, index]
---

## Problem
An image whose confident OCR text is shorter than the chunker's 50-char `minChunkChars` currently produces ZERO index chunks — it is unsearchable by BOTH dense AND BM25, even by an exact word that is plainly in the image.

Root cause is a DELIBERATE gate in `src/search.ts` `chunksFor()` (image branch, ~line 1715):
```ts
if (isIndexableImagePath(path)) {
    // Gate on minChunkChars FIRST ... a text-free / tiny-caption image yields ZERO
    // chunks, NOT chunkContent's title-only fallback — a filename like
    // "Pasted image 2024…" as a lexical vector is exactly the ranking pollution we don't want.
    if (cleanDenseBody(content).length < this.chunker.minChunkChars) return [];
    ...
}
```
The gate exists to stop a TEXT-FREE screenshot from being indexed as a filename-only vector (`content` here is the OCR text, title = basename). But it over-fires: a genuinely short-but-real OCR string (a diagram label, whiteboard word, meme caption) that already passed the OCR confidence gate is thrown away entirely.

Surfaced by the e2e work in ticket nid_bfwwesjlphmieihxc322eqna7_e: a rendered image OCR'd correctly to "photosynthesis xylopho" (conf 92) but, being ~22 chars, indexed to 0 chunks (worked around there by rendering longer text).

## Proposed change (BM25-only for short OCR text)
Split the image gate in `chunksFor()` into three cases on `len = cleanDenseBody(content).length`:
- `len === 0` → `return []` (text-free image; no real OCR text — dropping stays correct, keeps the "Pasted image …" pollution guard closed).
- `0 < len < minChunkChars` → emit ONE `lexicalOnly` chunk: content = cleaned OCR text, title = basename, `lexicalOnly: true`. BM25 indexes the OCR tokens; the ranker's dense floor for `lexicalOnly` chunks (`src/ranker.ts` ~line 131/137) keeps its vector OUT of the dense channel, so there is no dense-pollution.
- `len >= minChunkChars` → unchanged (rides `chunkContent`).

This reuses the exact `lexicalOnly` mechanism the note fallback already uses (`src/chunker.ts` ~lines 456-470). Build the chunk_id the SAME way the fallback does (`idFor(title, cleanedContent)`) so the sidecar liveness oracles re-derive identical ids (see the chunk_id-parity assertions in `src/image-indexing.test.ts`). Consider factoring a tiny shared helper rather than duplicating the chunk literal.

WHY this is safe pollution-wise: images with >= 50 chars of OCR ALREADY index their basename title into BM25 (3.0x title boost), so a short image doing the same introduces no new class of lexical pollution; the only NEW thing indexed is the (confident) short OCR text itself, which is exactly what we want to find.

## Version bump (required)
This changes chunking output for existing short images, so bump `CHUNKER_VERSION` in `src/chunker.ts` (currently 10 → 11); `src/identity.ts` aggregates it so persisted indexes re-chunk automatically. See project CLAUDE.md "Global invariants".

## Tests (required)
Primary — a tier-2 scenario unit test in `src/image-indexing.test.ts` (uses `Scenario`, `fakeOcrEngine`, `writeImage`, `ocrColdStart` from `src/test-harness/scenario.ts`):
- Write an image whose fake OCR text is ~30 chars of distinctive words; `ocrColdStart()`; assert `s.orch.search("<one of those words>")` returns the image `note_path` (i.e. BM25-searchable below minChunkChars).
- Assert the emitted chunk for that image is `lexicalOnly: true` (dense floored) — read via `s.store.listAllMeta()`.
- Assert a TEXT-FREE image (empty OCR) still yields ZERO chunks (the pollution guard stays closed).

Optional — extend the real-Obsidian e2e (`e2e/search.e2e.ts`) with a ~30-char-image variant, but the scenario unit test is the authoritative gate (e2e OCR is heavy).

## Acceptance
- A 30-char-OCR image is retrievable by a BM25 query for one of its words.
- Its chunk is lexicalOnly (no dense contribution).
- A text-free image still indexes to zero chunks.
- CHUNKER_VERSION bumped; `npm run test` + `npm run typecheck` green.

