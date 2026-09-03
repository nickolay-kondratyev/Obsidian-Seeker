---
id: nid_avq9wmbcrqb3k8c3clknc8gv5_e
title: "Model 2/6: sidecar record layout parameterized by embedding dim"
status: open
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e, nid_mny8ao7h45fiyiplclnl8ad68_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T20:25:50Z
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

