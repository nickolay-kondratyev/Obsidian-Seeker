---
closed_iso: 2026-11-17T19:04:36Z
id: nid_n59bc5o9ybvac25py88oc1vi3_e
title: "Ignore same-device other-vault sidecar producers + cold BM25 load must not adopt another vault's artifact"
status: closed
deps: []
links: [nid_5bp0gdi1w9d1svfcitafvnduh_e]
created_iso: 2026-11-17T18:23:19Z
status_updated_iso: 2026-11-17T19:04:36Z
type: bug
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [boot-wipe]
---


## Goal

When a vault has no local BM25 blob (fresh install / evicted IndexedDB), `SearchOrchestrator.tryLoadCrossDeviceBm25` (`src/search.ts`) loads the FRESHEST accepted sidecar producer's gzipped BM25 artifact. In a sidecar folder shared by several vaults (user's symlinked `.obsidian/plugins`, see nid_5bp0gdi1w9d1svfcitafvnduh_e) that producer can be ANOTHER vault: its postings reference chunk ids that aren't live here, `fromJSON` skips them and live chunks score 0 → lexical (BM25) recall is effectively gone until something forces a refit. Found by the ticket-2 implementer (pre-existing; not caused by the vault-scoped producer ids). The same-device rule below fixes the user's case; the corpus-overlap gate covers a shared folder synced to another machine.

## Added scope — human decision 2026-11-17 (Q2)

Vaults sharing one sidecar folder on the SAME device read each other's keyed files as peers → needless whole-vault re-chunks when both are open (each sidecar write changes the dir signature that wakes `reconcileSidecarIfChanged`), and on identity mismatch `rebuildFromSidecar` may nuke + hydrate from another vault's producer. Rule (decided): every sidecar READER ignores producers whose id starts with `<this deviceId>-` but is not exactly this vault's `logger.producerId`. Producers from OTHER devices (`mobile-…`, other `desktop-…`) are read exactly as today, whatever their vault key — phone piggyback must keep working. The bare legacy `<deviceId>` producer is out of scope here (nid_tu1d39wbva5bz5h2c2v7bjjlz_e deletes it).

## Done criteria

- One shared, explicitly named predicate decides "same device, other vault" and every reader path uses it: producer listing/ranking (`rankAcceptedProducers`), hydrate, `peerSidecarPresent`, peer-ahead, the reconcile dir signature (another vault's writes must not wake this vault's reconcile), `rebuildFromSidecar`, BM25 adoption — test per path that matters, at least: signature unchanged by a same-device other-vault write; hydrate ignores it; phone (`mobile-…`) still hydrates from `desktop-…-<key>`.

- A cold BM25 load never adopts an artifact whose postings mostly don't map onto this vault's live chunk frame; it falls through to the next producer or to a normal refit — unit test with two producers (other vault fresher, own/same-vault older).
- Cross-device adoption for the SAME vault (phone piggyback on desktop's artifact) still works — unit test.

## Context

- `src/search.ts`: `tryLoadCrossDeviceBm25`, `emitCrossDeviceBm25`, `rankAcceptedProducers` (from `src/sidecar-meta.ts`/`src/sidecar.ts`), `MultiFieldBM25.fromJSON` (`src/bm25.ts` — editing bm25.ts changes the analyzer hash; avoid unless needed).
- Producer ids are `<deviceId>-<vaultKey>` after nid_5bp0gdi1w9d1svfcitafvnduh_e.

## Constraints

- BM25 adoption gets BOTH: the decided same-device rule AND a corpus-agnostic overlap gate (share of the artifact's doc ids present in the live frame above a named threshold), because the same-device rule misses a shared folder synced to another machine.
- Don't edit `src/bm25.ts` unless unavoidable (analyzer-hash invariant in root `CLAUDE.md`).

## Non-goals

- Caching the adopted blob locally on hydrate-only devices (existing deferred follow-up).
