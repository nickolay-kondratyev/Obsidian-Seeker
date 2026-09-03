---
id: nid_mny8ao7h45fiyiplclnl8ad68_e
title: "Model 1/6: runtime ModelSpec + settings schema + identity/search/main plumbing"
status: open
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T20:25:50Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [model]
---

Model 1/6 — Runtime ModelSpec + settings schema + identity/search/main plumbing. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md (plan of record; sections "Target data model" and "Identity + storage").

GOAL: the active embedding model is derived from settings at runtime; the compile-time constants MODEL_ID / MODEL_REVISION / EMBEDDING_DIM disappear. Behavior for a user with no override is IDENTICAL to today (same model, same identity string, no reindex triggered on upgrade — verify: meta.modelId for the default must stay exactly 'tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX').

CHANGES
1. src/types.ts
   - Add `export type Pooling = 'cls' | 'mean';` and `export interface ModelOverride { repo: string; revision: string | null; dim: number; pooling: Pooling; dtype: Dtype; queryPrefix: string; docPrefix: string; }`.
   - SeekerSettings: add `modelOverride?: ModelOverride` (absent = shipped default; comment WHY it is synced: every device's identity follows it and the sidecar/identity cascade rebuilds). Remove `modelRepoOverride` / `modelRevisionOverride`.
   - settingsRev 10 → 11 in DEFAULT_SETTINGS (src/types.ts ~L648) + a migrateSettings clause (pattern: src/types.ts L662-737) that deletes the two debug keys. Test in src/settings-migrate.test.ts (pattern there: build Partial raw at old rev → migrateSettings → assert fields + final rev).
2. src/model-registry.ts
   - ModelSpec gains `pooling: Pooling; queryPrefix: string; docPrefix: string`; drop `files` (replace probeModelDownloaded's weight-file lookup with a dtype→filename map: q4→'model_q4.onnx', q8→'model_quantized.onnx', fp32→'model.onnx'; keep matching by URL fragment).
   - ML97_GBQ4: pooling 'cls', queryPrefix '', docPrefix ''.
   - `export function modelKeyFor(spec: Omit<ModelSpec,'key'>): string` — returns spec.repo when revision/pooling/docPrefix equal the shipped default's AND repo === shipped repo; otherwise `${repo}|rev=${revision ?? 'main'}|pool=${pooling}|doc=${docPrefix}`. Pure, unit-tested (incl. "default stays repo", "override with same repo but mean pooling differs").
   - `activeModelSpec(settings)`: settings.modelOverride ? { key: modelKeyFor(o), ...o } : ACTIVE_MODEL_SPEC. Delete resolveOverrideSpec. Update src/model-registry.test.ts (describe 'activeModelSpec / resolveOverrideSpec' L26-48 and any eviction tests that build settings with the old fields).
3. src/embedder.ts
   - Delete exports MODEL_ID, MODEL_REVISION, EMBEDDING_DIM and the LOCAL_MODEL dev toggle (plan decision: HF slug only; git history keeps it). Keep LEGACY_ENGLISH_MODEL_ID.
   - `load(spec: ModelSpec, requested: RequestedDevice)` replaces `load(requested, dtype, modelIdOverride?, revision?)`; store `_lastSpec` for recycle(); `get modelId()` returns the loaded spec.key; add `get spec(): ModelSpec | null`. ensureTokenizer(spec) likewise. The LoadEntry embeddingDim field uses spec.dim (ticket 3/6 will replace it with the detected dim; leave a TODO comment naming ticket 3/6). Do NOT touch the iframe payload beyond what compiles (ticket 3/6 owns pooling/outputDim).
4. src/identity.ts: `pluginIdentity(spec: ModelSpec)`; `identityHealEligibility(meta, live)` with `live` REQUIRED. Update src/identity.test.ts (it imports the deleted constants; build identities from ACTIVE_MODEL_SPEC instead).
5. src/sidecar-meta.ts expectationFor(id): make `id` required (no pluginIdentity() default). Fix all callers (src/search.ts L2487, 2593, 2684, 3004, 4156 per inventory; grep to be sure).
6. src/index-store.ts L611 default meta: take the dim from a constructor/open parameter or a `defaultEmbeddingDim` set by the orchestrator — do not import model-registry there.
7. src/search.ts: replace every EMBEDDING_DIM / MODEL_ID read (L510, 689, 1396, 1498, 1706, 1720-1721, 1846, 1992, 2443, 2503, 4838 per inventory) with a private getter `activeSpec()` = activeModelSpec(this.settings). Note L3487's bytesPerVec-vs-queryVec guard already uses live values — keep.
8. src/main.ts: ensureModelLoaded (L944-1106): `this.embedder.load(spec, requestedDevice)`; delete the spec.dim !== EMBEDDING_DIM guard (L999-1002) and every LOCAL_MODEL branch; delete the resolveOverrideSpec carve-out in enforceIndexIdentity (L1154); pluginIdentity(activeModelSpec(this.settings)) at L1173/1183; warnOnModelIndexDrift compares meta.modelId with activeModelSpec(this.settings).key.
9. Out-of-src callers of the old load signature: bench/harness/page-common.ts L78 and e2e/harness/page.ts (grep `embedder.load(`) → `embedder.load(ACTIVE_MODEL_SPEC, device)`.
10. src/dim-consistency.test.ts imports EMBEDDING_DIM — switch it to ACTIVE_MODEL_SPEC.dim (ticket 2/6 rewrites the sidecar part). src/iframe-runner.test.ts's literal 384 stays until 3/6.

ACCEPTANCE: `npm run typecheck` clean; `npm run test` green; new tests for modelKeyFor, activeModelSpec with an override, migration rev 11; a test asserting activeModelSpec(DEFAULT_SETTINGS).key === 'tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX'. Update src/CLAUDE.md §Layers one-liner for model-registry.ts (identity now runtime) — succinct. Record a change_log entry at the end.

