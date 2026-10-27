# Similar notes side panel — orchestrator decisions

Epic: `nid_z4vwfvotr3lfmjs4ke2ud6isa_e`. Human set the requirements (two modes, active-note tracking, visible-only compute, separate graph settings, separate command) and green-lit orchestration on 2026-10-26. These are the calls the orchestrator made on its own:

1. **Default mode = "best chunk match"** (each chunk of the active note searched separately, a candidate's score is its best chunk-to-chunk cosine). The human said it "makes sense"; "average" is the alternative in the panel's popover.
2. **Panel = graph + compact ranked list.** Graph titles only show on hover/selection, so without a list you can't scan names. The list also gives mobile something to show (graph stays desktop-only, same as the search modal's map).
3. **Dense-only similarity.** BM25, recency and title boost are signals about query text; they have no meaning note-to-note.
4. **Mode + graph knobs live in the panel's own tuning popover**, persisted separately from the modal's `resultMapTuning`. No settings-tab section.
5. **Source-chunk cap in best-chunk mode.** Very long notes are capped at a named constant number of chunks scanned (ceiling documented in code).

Reverse any of these by editing the 3/3 ticket before it starts, or by a follow-up ticket.
