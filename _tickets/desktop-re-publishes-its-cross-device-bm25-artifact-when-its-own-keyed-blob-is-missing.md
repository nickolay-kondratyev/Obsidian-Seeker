---
closed_iso: 2026-11-17T19:25:20Z
id: nid_s4h30wnw7qfkrj638iplwdacn_e
title: "Desktop re-publishes its cross-device BM25 artifact when its own keyed blob is missing"
status: closed
deps: [nid_tu1d39wbva5bz5h2c2v7bjjlz_e]
links: [nid_tu1d39wbva5bz5h2c2v7bjjlz_e, nid_n59bc5o9ybvac25py88oc1vi3_e]
created_iso: 2026-11-17T19:06:55Z
status_updated_iso: 2026-11-17T19:25:20Z
type: task
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [boot-wipe]
---


## Goal

The cross-device BM25 artifact (`bm25.<producerId>.json.gz` in the sidecar dir) lets a fresh/evicted device — mostly phones — LOAD the lexical index instead of refitting over all bodies (the mobile cold-start freeze). `SearchOrchestrator.emitCrossDeviceBm25` (`src/search.ts`) publishes it only after a FULL reindex. After the vault-keyed producer rename (nid_5bp0gdi1w9d1svfcitafvnduh_e) and the legacy-file migration (nid_tu1d39wbva5bz5h2c2v7bjjlz_e, which deletes the legacy un-keyed blob because in a shared plugins folder it may be another vault's corpus), no keyed blob exists until the user's next full reindex — possibly months — so every fresh/evicted phone refits in the meantime.

Decision (orchestrator, from reviewer recommendation; the safe option — always this vault's own corpus): a desktop whose BM25 cache is warm and complete re-publishes its keyed artifact when that artifact is missing from the sidecar dir.

## Done criteria

- GIVEN a desktop with a complete local index + warm BM25 and no `bm25.<producerId>.json.gz` on disk, WHEN its caches warm (the existing warm path, not the search hot path), THEN the keyed artifact is written once — unit test.
- No re-emit when the artifact already exists (no per-warm rewrite) — test.
- Never emitted from an incomplete index (same gates as today's emit: desktop-only, `lastIndexedAt` set, gzip available, sidecar on) — test.
- A phone consumer adopts the re-published artifact (passes the stamp check and the ≥50% overlap gate from nid_n59bc5o9ybvac25py88oc1vi3_e) — test.

## Context

- `src/search.ts`: `emitCrossDeviceBm25`, `warmCaches`, `persistBm25`, `tryLoadCrossDeviceBm25` / adoption helper; `bm25PathFor` in `src/sidecar.ts`.
- Root `CLAUDE.md`: `npm run bench` is the indexing-perf bench — run it only if the warm path's batching/pacing changes (it shouldn't).

## Non-goals

- Copying the legacy blob to the keyed name (rejected: may be another vault's corpus).
- Emitting from mobile.
