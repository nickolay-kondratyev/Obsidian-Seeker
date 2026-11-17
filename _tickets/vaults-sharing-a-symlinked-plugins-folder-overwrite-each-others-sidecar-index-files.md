---
id: nid_5bp0gdi1w9d1svfcitafvnduh_e
title: "Vaults sharing a symlinked plugins folder overwrite each other's sidecar index files"
status: open
deps: []
links: [nid_oa3w5abv27trliro95mqpc7h9_e, nid_bn1mmy0av706371brezkpnxnh_e]
created_iso: 2026-11-17T18:03:09Z
status_updated_iso: 2026-11-17T18:03:09Z
type: bug
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [boot-wipe, decide, need-human]
---

## Goal

Several of the user's vaults symlink `.obsidian/plugins` to one shared folder (`_obsidian-shared-vault/.obsidian/plugins`). Seeker's sidecar (the file-based index backup, default location `.obsidian/plugins/seeker/index/`) names its own files by device id only (`index.<deviceId>.jsonl`, `embeddings.<deviceId>.N.bin`, `meta.<deviceId>.json`, …). The device id is localStorage-backed and origin-wide (`src/logger.ts` `resolveDeviceId`), so EVERY vault on the machine writes the same files. When vault B compacts "its own" sidecar it erases vault A's entries. Observed: sidecar shrank from ~10.8k to ~2.4k entries in 5 minutes as different vaults opened. Effect: the sidecar can't restore a vault after an index loss (one vault booted empty and logged `index-stranded: the sidecar held nothing this device could reproduce`). Logs (`logs/seeker-log-<deviceId>.ndjson`) interleave across vaults too.

Once nid_oa3w5abv27trliro95mqpc7h9_e lands, the boot wipe stops, so this mostly matters when IDB is actually lost. Hence priority 2.

## Decision needed (human)

- A. Scope the producer key by vault: `<deviceId>-<short hash of appId>` for sidecar + log file names. Fixes the collision for everyone. Cost: a one-time migration question for existing `*.<deviceId>.*` files (which vault owns them is unknowable) — e.g. leave them as read-only legacy peers and let them age out, or delete them on first scoped write. Cross-device sync keeps working (peers are read by content-addressed chunk id). **Recommended.**
- B. Detect a plugins folder shared by several vaults and warn, telling the user to switch the "index location" to "visible" (sidecar inside each vault). Cheaper, no format change, but a manual step.
- C. Do nothing in code; the user sets index location = "visible" (works today, since `data.json` is shared, it applies to all vaults; each vault then gets a visible index folder).

## Done criteria (for option A)

- Two vaults sharing one plugins folder on one device never write the same sidecar/log file; a test proves vault B's compaction leaves vault A's sidecar intact.
- Existing single-vault users keep hydrating from their existing sidecar files and from peers on other devices (test).
- Sidecar version/format bump only if the on-disk shape changes (root `CLAUDE.md` invariant).

## Context

- `src/sidecar.ts`, `src/sidecar-sync.ts`, `src/sidecar-meta.ts` (producer file naming, compaction `compactOwnSidecar`, hydrate), `src/logger.ts` (`resolveDeviceId`, log file naming), `src/main.ts` (`resolveSidecarIndexDir`, `sidecarConfigDir`/`sidecarVisibleDir`, settings `sidecarIndexLocation`).
- IDB is already vault-scoped (`seeker-index:<appId>`, `src/index-store.ts`) — only the file-based artifacts collide.

## Non-goals

- Changing the boot-reconcile timing (nid_oa3w5abv27trliro95mqpc7h9_e).
- Scoping `data.json` settings per vault.
