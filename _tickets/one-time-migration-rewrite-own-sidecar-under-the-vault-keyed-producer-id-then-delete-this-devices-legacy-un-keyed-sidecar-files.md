---
id: nid_tu1d39wbva5bz5h2c2v7bjjlz_e
title: "One-time migration: rewrite own sidecar under the vault-keyed producer id, then delete this device's legacy un-keyed sidecar files"
status: in_progress
deps: []
links: [nid_5bp0gdi1w9d1svfcitafvnduh_e, nid_n59bc5o9ybvac25py88oc1vi3_e]
created_iso: 2026-11-17T18:52:14Z
status_updated_iso: 2026-11-17T18:52:50Z
type: bug
priority: 1
assignee: CC_WITH-nickolaykondratyev
tags: [boot-wipe]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.worktree/t-tu1d39wb
profile: higher
---


## Goal

nid_5bp0gdi1w9d1svfcitafvnduh_e (merged) renamed this device's sidecar producer id from `<deviceId>` to `<deviceId>-<vaultKey>` (`logger.producerId`, `src/logger.ts`) and left the legacy un-keyed files (`index.<deviceId>.jsonl`, `embeddings.<deviceId>.N.bin`, `meta.<deviceId>.json`, `bm25.<deviceId>.json.gz`) untouched. The reviewer found (from code) two costs of leaving them, which affect EVERY existing user, so this blocks the next release:
1. `SearchOrchestrator.peerSidecarPresent` (`src/search.ts`) sees the legacy files as another device → after the next identity bump a stale index shows the calm "a newer index is syncing from another device" banner (no button) instead of "please reindex" (`enforceIndexIdentity`, `src/main.ts`).
2. Legacy records are never tombstoned/compacted again, so ids edited after the upgrade stay "fresh" there and defeat hydrate's no-fresh-ids skip → every peer sidecar change triggers a whole-vault re-chunk on every device incl. phones (known iOS jank/jetsam pattern).

Human decision (2026-11-17, option C): on first boot of the new build, REWRITE this vault's full own sidecar under the new producer id from its intact index, THEN delete this device's legacy un-keyed files. In a plugins folder shared by several vaults, the first vault to migrate deletes the shared legacy files — accepted; each vault writes its own full keyed sidecar on its own first boot.

## Done criteria

- After the migration, this vault's keyed sidecar alone can restore its full index (test: wipe IDB → hydrate → same chunk set), and no `*.<bareDeviceId>.*` sidecar artifact (incl. `.tmp`) remains.
- Crash-safe ordering: legacy files are deleted only AFTER the full keyed sidecar is durably written; an interruption at any point leaves either the legacy files or a complete keyed sidecar (test the "crash between write and delete" case → next boot finishes it).
- Never deletes legacy files when this vault's index can't vouch for itself: empty / partially hydrated / identity-stale index → skip this boot (legacy files may be the only backup). Test.
- Idempotent and one-time in effect: a later boot with no legacy files does nothing (no full rewrite each boot) — test. Derive "needs migration" from disk state (legacy own files present) rather than a new persisted flag unless there is a reason.
- Runs inside the layout-ready-gated boot work (root invariant in `src/CLAUDE.md`), under the coordinator write lock, off the load path; must not run on mobile in a way that risks the jetsam window (a full rewrite on a large vault on iOS — decide: allow, defer to idle, or desktop-only; justify).
- With legacy files gone, `peerSidecarPresent` no longer reports a phantom peer on a single-device vault (test).
- Other devices' files (`mobile-…`, other `desktop-…`) and their legacy un-keyed files are never touched (test).

## Context

- `src/search.ts`: `compactOwnSidecar` (rewrites own sidecar — likely the reusable primitive for "rewrite full own sidecar from IDB"), `peerSidecarPresent`, `hydrateSidecar`, `reconcileSidecarIfChanged`; `src/sidecar.ts` (path helpers `jsonlPathFor`/`shardPathFor`/`metaPathFor`/`bm25PathFor`, `deviceIdFromArtifactPath`, `sweepOrphanTmpFiles`, atomic writes); `src/sidecar-meta.ts`; `src/main.ts` boot reconcile (`runBootReconcile`, gated on `onLayoutReady`).
- `logger.deviceId` = bare device id (legacy producer name); `logger.producerId` = new keyed id.
- Concurrent work: nid_n59bc5o9ybvac25py88oc1vi3_e changes which producers are READ (skip same-device other-vault producers). Don't implement that here.

## Non-goals

- Legacy LOG files (`logs/seeker-log-<deviceId>.ndjson`) — leave them.
- Migrating/cleaning other devices' legacy files.
- Any sidecar format/version change.
