---
closed_iso: 2026-11-20T18:05:12Z
id: nid_5icqphif0kxwg5pgygti668d8_e
title: "Opened 3/3: last-opened times merge across devices"
status: closed
deps: [nid_aqto46kr20cwc4w3ry61b851l_e]
links: []
created_iso: 2026-11-20T16:42:22Z
status_updated_iso: 2026-11-20T18:05:12Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
parent: nid_8mpjxf78jw4ita3azfwijr4g8_e
tags: [opened-filter]
---


Part 3 of 3 of feature `nid_8mpjxf78jw4ita3azfwijr4g8_e` (read its "Decisions" section first; they are settled). Builds on the open-history store from ticket `nid_aqto46kr20cwc4w3ry61b851l_e`. Independent of the filter ticket `nid_cwgsa0eizaicst9n1h2pq0wyi_e`: this ticket changes only the store module and its tests, never the filter, field, commands or the search path.

## Goal

A note opened on one of the user's devices counts as opened on all of them: open a note on the phone in the morning, and "opened today" on the desktop lists it once sync has delivered the phone's open-history file. Each device already writes its own file into the synced sidecar index directory; this ticket makes every device read the others' and answer with the newest time per path.

## Done criteria

- The store's `lastOpenedMs(path)` returns the newest time across this producer's own records and every PEER producer's open-history file.
- Same-device other-vault producers are skipped with the shared predicate `isSameDeviceOtherVaultProducer` (`src/sidecar.ts`); producers from other devices are read whatever their vault key. A test covers: own file, a peer device's file (read), this device's other vault (ignored).
- A peer file that arrives or changes while Obsidian is running is reflected after the next `refresh()` (the method every `opened-after:` search already awaits), without a restart. An unchanged directory costs no file reads: a size/mtime check decides and only changed files are re-read (test: second `refresh()` with nothing changed does zero reads).
- This device never writes, rewrites or deletes a peer's file. Its own file's periodic rewrite keeps only its OWN records — peer times are not copied into it — with one exception below.
- Rename carry-over uses the merged time: a note opened only on the phone and then renamed on the desktop keeps its time under the new path (the desktop records it in its own file).
- Sync conflict copies and any file whose name does not match the strict per-producer pattern are ignored. Torn or unparseable lines in a peer file are skipped; the rest of that file still counts. A peer's in-flight `.tmp` file is never read, restored or deleted.
- Works with `sidecarEnabled` off.
- The synchronous signature of `lastOpenedMs` and the meaning of `refresh()` are unchanged, so no caller changes.
- Unit tests with the in-memory adapter fake and injected clock; `npm run test` and `npm run typecheck` pass.
- A code comment at the peer-read site names the known ceiling below.

## Context

- The store, its file location/name and record shape come from ticket `nid_aqto46kr20cwc4w3ry61b851l_e` — read the delivered module first; the paths there are authoritative. It is already constructed with the full `SidecarSelf`, so no wiring in `src/main.ts` or `src/search.ts` should need to change; if it does, keep the edit to the store's construction site (ticket `nid_cwgsa0eizaicst9n1h2pq0wyi_e` edits the search path and commands in parallel).
- Peer-reading precedent: `src/sidecar-sync.ts` (the private `listReadableJsonls`) and `src/sidecar.ts` (`SidecarSelf`, `isSameDeviceOtherVaultProducer`, `sidecarDirSignature` for the size+mtime change check, the strict filename regexes that exclude conflict copies). `SidecarSelf` is `{ deviceId, producerId }` from the logger (`src/logger.ts`).
- Why other-device producers are read regardless of vault key: two devices of one synced vault have DIFFERENT vault keys (the key derives from a per-device app id), so only the device prefix separates "my other vault" from "my vault on another device" (comment above `isSameDeviceOtherVaultProducer`; human decision recorded in closed ticket `nid_n59bc5o9ybvac25py88oc1vi3_e`).
- Open ticket `nid_bn1mmy0av706371brezkpnxnh_e` (partial sidecar producers) does not apply: a peer open-history file is additive per path, so a partial or stale one is simply less information, never wrong data.

## Constraints

- Known ceiling, accepted by the human: when two different vaults share one plugins folder AND both hold a file at the same vault-relative path, an open on another device in one vault can count for the other. It cannot be separated without a cross-device vault identity, which does not exist.
- Timestamps are compared as recorded (each device's own clock). No skew correction.
- No polling timer for peer changes: check inside `refresh()`, when the data is needed.

## Non-goals

- Merging into one shared file, or any write to a peer's file.
- Reaping files of devices that no longer exist (they are small and harmless).
- Showing which device opened a note; clock-skew handling.
- Any change to the filter, the field UI or the commands.
