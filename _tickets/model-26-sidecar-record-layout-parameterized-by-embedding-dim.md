---
closed_iso: 2026-09-03T21:35:04Z
session_ids: [{"a": "claude", "type": "execution", "id": "f3139814-e6cf-498e-8388-0dbc2484c614"}, {"a": "claude", "type": "review", "id": "5ae71a4a-acc7-4c8b-9256-dc8985fa0cc3"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-2
id: nid_avq9wmbcrqb3k8c3clknc8gv5_e
title: "Model 2/6: sidecar record layout parameterized by embedding dim"
status: closed
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e, nid_mny8ao7h45fiyiplclnl8ad68_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T21:35:04Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [model]
---

Model 2/6 — Sidecar record layout parameterized by embedding dimension. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md ("Identity + storage"). Depends on 1/6 (runtime ModelSpec) being merged.

GOAL: src/sidecar.ts encodes/decodes records for ANY dim, not the compile-time 384. The byte layout for dim 384 must stay byte-identical (existing on-disk sidecars keep hydrating; NO SIDECAR_FORMAT bump).

CURRENT STATE (inventory): src/sidecar.ts L39-56 defines Q_BYTES = ACTIVE_MODEL_SPEC.dim, S_BYTES = 8, SIGN_BYTES = ceil(Q_BYTES/8), RECORD_PAYLOAD_BYTES, VEC_BYTES (= stride), DIM, MAX_VECTORS_PER_SHARD. encodeRecord (L152) validates against Q_BYTES/SIGN_BYTES; decodeRecord(buf, off, expectedDim = DIM) (L168) only ASSERTS expectedDim === DIM and still slices with the module constants. Callers pass the per-record stored dim already: readRecordAt L507/513, bulkAppend L723/750 (writes dim: DIM), compactDevice L856/962, coalesceSmallShards L1048/1085/1109, src/sidecar-sync.ts L282/290. Every jsonl ref line carries `dim`; SidecarMeta.dim (src/sidecar-meta.ts) gates cross-dim hydration via metaAccepts.

CHANGES
1. Replace the module constants with `export interface RecordLayout { dim: number; qBytes: number; sBytes: 8; signBytes: number; payloadBytes: number; vecBytes: number; maxVectorsPerShard: number }` and `export function recordLayout(dim: number): RecordLayout` (pure; sBytes/CRC unchanged). Keep S_BYTES and CRC_BYTES as constants.
2. encodeRecord(t, layout) / decodeRecord(buf, off, layout) slice by the layout. decodeRecord still refuses a stride mismatch: callers pass recordLayout(entry.dim) and the CALLER decides whether entry.dim equals the active dim (hydrate paths already gate via metaAccepts; a mismatched record → skip + re-embed, as today).
3. bulkAppend / compactDevice / coalesceSmallShards / readRecordAt / SidecarSync: take the active dim (from activeModelSpec(settings).dim — SidecarSync receives it from SearchOrchestrator) and write `dim` from it. Shard capacity uses layout.maxVectorsPerShard.
4. Remove the ACTIVE_MODEL_SPEC import from src/sidecar.ts (it must be model-free; the header comment already says its ONE model dependency is dim).
5. Tests: src/sidecar.test.ts and src/sidecar-sync.test.ts use Q_BYTES/SIGN_BYTES for fixtures → use recordLayout(384). Add roundtrip tests for dims 256, 768 and 1024 (encode→decode, CRC, sign width = ceil(dim/8)) and a fixture assertion that recordLayout(384).vecBytes === 444 (the documented on-disk stride). Rewrite src/dim-consistency.test.ts: the single-source invariant becomes "recordLayout(ACTIVE_MODEL_SPEC.dim) composes correctly and packSignBits(vec of that dim) has signBytes length"; keep its forward-width sweep.

ACCEPTANCE: typecheck + `npm run test` green; a 384-d record encoded by the new code is byte-identical to one encoded by the old code (write the expected bytes into the test from the current implementation BEFORE refactoring — start with that failing/pinning test). change_log entry.

---

## RESOLUTION (done 2026-09-03)

`src/sidecar.ts` is now MODEL-FREE. Removed the `ACTIVE_MODEL_SPEC` import and the
compile-time stride constants (`Q_BYTES`, `SIGN_BYTES`, `VEC_BYTES`,
`RECORD_PAYLOAD_BYTES`, `DIM`, `MAX_VECTORS_PER_SHARD`). Added:

- `export interface RecordLayout { dim; qBytes; sBytes: 8; signBytes; payloadBytes; vecBytes; maxVectorsPerShard }`
- `export function recordLayout(dim): RecordLayout` — pure. `S_BYTES` (now `8 as const`),
  `CRC_BYTES`, `SHARD_CAP_BYTES` stay module constants.
- `encodeRecord(t, layout)`, `decodeRecord(buf, off, layout)`,
  `isOffsetInRange(binSize, off, layout)` all slice by the passed layout.

**dim threading — how it actually landed (deviation from point 3's literal wording, called out):**
Point 2 (decode paths pass `recordLayout(entry.dim)`) and point 3 ("all take the
active dim") conflict for the read/copy paths; point 2 is the correct one and is
what's implemented:

- `bulkAppend(adapter, dir, dev, records, dim)` — the ONLY mint path — takes the
  **active** dim (`job.identity.dim` in `search.ts`), encodes at `recordLayout(dim)`,
  writes `dim` into every jsonl line, and uses `layout.maxVectorsPerShard` for shard
  chunking. `encodeRecord` throws if a tier's byte width disagrees → storage-boundary
  guard that a wrong-width vector never lands on disk.
- `readRecordAt`, `sidecar-sync` step 7, and the byte-copies inside `compactDevice` /
  `coalesceSmallShards` all key off the **stored per-record `e.dim`**
  (`recordLayout(e.dim)`), because a byte copy must use the SOURCE record's stride.
  These therefore did NOT gain an active-dim parameter (it would have been unused —
  the own sidecar is homogeneous, so `e.dim` == active dim in practice anyway).
  This keeps `dim: e.dim` on rewritten lines exactly as before and avoids ~24 churny
  call-site changes.

`decodeRecord` no longer has an explicit `dim !== DIM` assert; a wrong-width read now
fails loud via the existing range guard (`off + vecBytes > buffer`) or the CRC (a
mismatched stride mis-aligns the CRC window) — both are the same "skip + re-embed"
conditions callers already catch.

**Byte-identity:** the dim-384 layout composes to the same 444 B stride
(q 384 | s 8 | sign 48 | crc 4). Pinned by a frozen-hex test in `src/sidecar.test.ts`
(`PINNED_384_HEX`, captured from the pre-refactor compile-time-384 implementation) —
NO `SIDECAR_FORMAT` bump, existing on-disk sidecars keep hydrating.

**Tests:** `sidecar.test.ts` / `sidecar-sync.test.ts` build a local `L = recordLayout(384)`
for fixtures; added codec round-trips at dims 256/768/1024/1000 (sign width = ceil(d/8))
and the `vecBytes === 444` assertion. `dim-consistency.test.ts` rewritten around
`recordLayout(ACTIVE_MODEL_SPEC.dim)` composing correctly + `packSignBits` width match,
keeping the forward-width sweep. Full suite: 1488 passed / 19 skipped; typecheck + build green.
change_log: `2026-09-03_21-34-37Z`.


## Notes

**2026-09-03T21:38:02Z**

__READY_AS_IS__: recordLayout refactor is byte-identical to dim-384 (hex pin), typecheck+full suite green (1488 pass); dropped decode-time dim assert is safely covered by metaAccepts dim gate + homogeneous per-device jsonl.
