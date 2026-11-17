---
closed_iso: 2026-11-17T18:28:23Z
id: nid_5bp0gdi1w9d1svfcitafvnduh_e
title: "Vaults sharing a symlinked plugins folder overwrite each other's sidecar index files"
status: closed
deps: []
links: [nid_oa3w5abv27trliro95mqpc7h9_e, nid_bn1mmy0av706371brezkpnxnh_e]
created_iso: 2026-11-17T18:03:09Z
status_updated_iso: 2026-11-17T18:28:23Z
type: bug
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [boot-wipe]
profile: higher
---

## Goal

Several of the user's vaults symlink `.obsidian/plugins` to one shared folder (`_obsidian-shared-vault/.obsidian/plugins`). Seeker's sidecar (the file-based index backup, default location `.obsidian/plugins/seeker/index/`) names its own files by device id only (`index.<deviceId>.jsonl`, `embeddings.<deviceId>.N.bin`, `meta.<deviceId>.json`, …). The device id is localStorage-backed and origin-wide (`src/logger.ts` `resolveDeviceId`), so EVERY vault on the machine writes the same files. When vault B compacts "its own" sidecar it erases vault A's entries. Observed: sidecar shrank from ~10.8k to ~2.4k entries in 5 minutes as different vaults opened. Effect: the sidecar can't restore a vault after an index loss (one vault booted empty and logged `index-stranded: the sidecar held nothing this device could reproduce`). Logs (`logs/seeker-log-<deviceId>.ndjson`) interleave across vaults too.

Once nid_oa3w5abv27trliro95mqpc7h9_e lands, the boot wipe stops, so this mostly matters when IDB is actually lost. Hence priority 2.

## Decisions (human, 2026-11-17)

- Scope the sidecar producer key AND the log file names by vault: `<deviceId>-<vaultKey>`. vaultKey derives from Obsidian's per-vault `app.appId` (the same id `src/main.ts` already uses to scope the IndexedDB name, with its vault-name fallback) — NOT the vault name (rename-fragile, collides on same-named folders). A short stable hash of it is fine for file names.
- Existing un-keyed files (`*.<deviceId>.*` without a vault key): forget about them for now — no migration, no cleanup, no special-case code. Whatever the existing reader does with an unknown producer's files is acceptable.
- Split log files per vault too (`logs/seeker-log-<deviceId>-<vaultKey>.ndjson`, same for the init file) so one log no longer mixes vaults.
- Rejected: warning-only (B) and settings-only workaround (C).

## Done criteria

- Two vaults sharing one plugins folder on one device never write the same sidecar/log file; a test proves vault B's compaction leaves vault A's sidecar intact.
- Hydrate from peers on OTHER devices keeps working (a peer's files are read regardless of its vault key) — test.
- Phone piggyback: a mobile consumer (own id `mobile-…-<its vault key>`) hydrates from a desktop producer written under the new vault-keyed name `desktop-…-<vaultKey>` — test. Keep the `desktop-`/`mobile-` prefix at the front of the producer id (prefix checks + the existing `[A-Za-z0-9-]+` filename regex in `src/sidecar.ts` must keep matching, so older builds on other devices still read the new files).
- Own-device logic (compaction, own-producer detection, peer-ahead) keys on the new vault-scoped producer id, so it never touches another vault's files — test.
- Logs and init file are per vault — test.
- Sidecar version/format bump only if the on-disk shape changes (root `CLAUDE.md` invariant).

## Context

- `src/sidecar.ts`, `src/sidecar-sync.ts`, `src/sidecar-meta.ts` (producer file naming, compaction `compactOwnSidecar`, hydrate), `src/logger.ts` (`resolveDeviceId`, log file naming), `src/main.ts` (`resolveSidecarIndexDir`, `sidecarConfigDir`/`sidecarVisibleDir`, settings `sidecarIndexLocation`).
- IDB is already vault-scoped (`seeker-index:<appId>`, `src/index-store.ts`) — only the file-based artifacts collide.

## Non-goals

- Changing the boot-reconcile timing (nid_oa3w5abv27trliro95mqpc7h9_e).
- Scoping `data.json` settings per vault.
