---
id: nid_bn1mmy0av706371brezkpnxnh_e
title: "rebuildFromSidecar accepts partial producers (no coverage check)"
status: open
deps: []
links: []
created_iso: 2026-10-20T18:05:00Z
status_updated_iso: 2026-10-20T18:05:00Z
type: bug
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [decide]
---

Found during review of ticket nid_taexabol48s18drqbg0ikk9pl_e (pre-existing, not introduced by it).

`rebuildFromSidecar` in `src/search.ts` (~line 2926), called from the identity heal in `src/main.ts` `enforceIndexIdentity`, nukes the local index and hydrates from ANY sidecar producer that `metaAccepts` the live identity. It never checks how much of the vault that producer covers. A partial current-version producer (e.g. a peer's sidecar after only the first burst of a split cold first build) can therefore reduce a version-stale device's index to a handful of notes.

Commit 8f16c11 already stops one source of partial producers (a delta on a version-stale index no longer publishes). Related: a full reindex publishes its sidecar only once at the end, so an interrupted full reindex leaves this device with an emptied sidecar until the next full pass finishes.

Decide on a coverage gate (e.g. require producer ids to cover most live notes, else fall through to the consent banner).

