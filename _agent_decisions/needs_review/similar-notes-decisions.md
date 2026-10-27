# Similar notes side panel — orchestrator decisions

Epic: `nid_z4vwfvotr3lfmjs4ke2ud6isa_e`. Human set the requirements (two modes, active-note tracking, visible-only compute, separate graph settings, separate command) and green-lit orchestration on 2026-10-26. These are the calls the orchestrator made on its own:

1. **Default mode = "best chunk match"** (each chunk of the active note searched separately, a candidate's score is its best chunk-to-chunk cosine). The human said it "makes sense"; "average" is the alternative in the panel's popover.
2. **Panel = graph + compact ranked list.** Graph titles only show on hover/selection, so without a list you can't scan names. The list also gives mobile something to show (graph stays desktop-only, same as the search modal's map).
3. **Dense-only similarity.** BM25, recency and title boost are signals about query text; they have no meaning note-to-note.
4. **Mode + graph knobs live in the panel's own tuning popover**, persisted separately from the modal's `resultMapTuning`. No settings-tab section.
5. **Source-chunk cap in best-chunk mode.** Very long notes are capped at a named constant number of chunks scanned (ceiling documented in code).

Reverse any of these by editing the 3/3 ticket before it starts, or by a follow-up ticket.

## Calls made during implementation (all merged)
6. **Title-only notes never show as similar** (and an empty active note gets no results): their only vector is the title, which would match on name, not content.
7. **Best-chunk cap = 16 sections, spread evenly across the note** (`MAX_SOURCE_CHUNKS_SCANNED`, `src/similar-notes.ts`), from a measured worst case under ~50 ms at 50k chunks.
8. **Panel shows the top 20** (`SIMILAR_NOTES_TOP_K`).
9. **Index changes refresh the panel once indexing has been quiet for 1.5 s**, so it does not update mid-reindex (each refresh reloads the in-memory index).
10. **Graph hidden when fewer than 2 similar notes**; list only.
11. **Mobile: list only, so "Similar by" can only be changed on desktop** (the popover lives in the graph header); a synced setting still applies.
12. **Clicking inside the panel or any sidebar does not change the followed note**; popout windows count as main area.
