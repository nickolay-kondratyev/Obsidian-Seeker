---
id: nid_n59bc5o9ybvac25py88oc1vi3_e
title: "Cold BM25 load can adopt another vault's lexical index from a shared sidecar folder"
status: open
deps: []
links: [nid_5bp0gdi1w9d1svfcitafvnduh_e]
created_iso: 2026-11-17T18:23:19Z
status_updated_iso: 2026-11-17T18:23:19Z
type: bug
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: []
---


## Goal

When a vault has no local BM25 blob (fresh install / evicted IndexedDB), `SearchOrchestrator.tryLoadCrossDeviceBm25` (`src/search.ts`) loads the FRESHEST accepted sidecar producer's gzipped BM25 artifact. In a sidecar folder shared by several vaults (user's symlinked `.obsidian/plugins`, see nid_5bp0gdi1w9d1svfcitafvnduh_e) that producer can be ANOTHER vault: its postings reference chunk ids that aren't live here, `fromJSON` skips them and live chunks score 0 → lexical (BM25) recall is effectively gone until something forces a refit. Found by the ticket-2 implementer (pre-existing; not caused by the vault-scoped producer ids). Low frequency on desktop (needs a missing local BM25 blob), hence priority 3.

## Done criteria

- A cold BM25 load never adopts an artifact whose postings mostly don't map onto this vault's live chunk frame; it falls through to the next producer or to a normal refit — unit test with two producers (other vault fresher, own/same-vault older).
- Cross-device adoption for the SAME vault (phone piggyback on desktop's artifact) still works — unit test.

## Context

- `src/search.ts`: `tryLoadCrossDeviceBm25`, `emitCrossDeviceBm25`, `rankAcceptedProducers` (from `src/sidecar-meta.ts`/`src/sidecar.ts`), `MultiFieldBM25.fromJSON` (`src/bm25.ts` — editing bm25.ts changes the analyzer hash; avoid unless needed).
- Producer ids are `<deviceId>-<vaultKey>` after nid_5bp0gdi1w9d1svfcitafvnduh_e.

## Constraints

- Prefer a corpus-agnostic check (e.g. share of the artifact's doc ids present in the live frame above a named threshold) over "skip same-device other-vault ids" — the latter misses a shared folder synced to another machine. Implementer's call; justify.

## Non-goals

- Caching the adopted blob locally on hydrate-only devices (existing deferred follow-up).
