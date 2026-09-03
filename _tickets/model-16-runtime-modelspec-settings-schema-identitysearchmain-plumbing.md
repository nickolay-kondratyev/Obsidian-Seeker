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
profile: higher
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
   - `export function modelKeyFor(m: Pick<ModelSpec, 'repo' | 'pooling' | 'docPrefix'>): string` — returns m.repo when repo/pooling/docPrefix all equal ML97_GBQ4's; otherwise `${repo}|pool=${pooling}|doc=${docPrefix}`. revision and dim are NOT in the key on purpose: IndexIdentity.revision/dim (src/identity.ts identityMatches) and the sidecar MetaExpectation (metaAccepts) already compare them as separate fields (plan: "Target data model"). Pure, unit-tested: "default stays repo", "override with the shipped repo + same pooling/prefix keeps the plain repo key (a revision change is caught by identity.revision)", "same repo but mean pooling differs", "docPrefix differs".
   - `export type ModelLoadSpec = Omit<ModelSpec, 'dim'> & { dim: number | null }` — what LocalEmbedder.load takes (a ModelSpec is assignable to it). dim null = "detect, don't check"; only candidate validation (ticket 5/6) passes null. Document on the type.
   - `activeModelSpec(settings)`: settings.modelOverride ? { key: modelKeyFor(o), ...o } : ACTIVE_MODEL_SPEC. Delete resolveOverrideSpec. Update src/model-registry.test.ts (describe 'activeModelSpec / resolveOverrideSpec' L26-48 and any eviction tests that build settings with the old fields).
3. src/embedder.ts
   - Delete exports MODEL_ID, MODEL_REVISION, EMBEDDING_DIM and the LOCAL_MODEL dev toggle (plan decision: HF slug only; git history keeps it). Keep LEGACY_ENGLISH_MODEL_ID.
   - `load(spec: ModelLoadSpec, requested: RequestedDevice)` replaces `load(requested, dtype, modelIdOverride?, revision?)`; store `_lastSpec: ModelLoadSpec | null` for recycle() (replaces _lastRequested/_lastReqDtype/_lastModelId/_lastRevision except the device); `get modelId()` returns `this._lastSpec?.key ?? ''` (no compiled default any more — search.ts must therefore stamp meta from activeSpec().key, see item 7). ensureTokenizer(spec: Pick<ModelLoadSpec,'repo'|'revision'>) likewise (search.ts calls it — grep `ensureTokenizer(`). The LoadEntry embeddingDim field uses `spec.dim ?? 0` for now (ticket 3/6 replaces it with the measured dim; leave a TODO comment naming ticket 3/6). In this ticket the runner payload still sends the old fields (modelId = spec.repo, revision = spec.revision, dtype = spec.dtype); do NOT touch the iframe beyond what compiles (ticket 3/6 owns pooling/outputDim).
4. src/identity.ts: `pluginIdentity(spec: ModelSpec)` (modelId = spec.key, revision = spec.revision, dim = spec.dim); `identityHealEligibility(meta, live)` with `live` REQUIRED. Callers to update (per grep 2026-09-03): src/main.ts L1173, L1183 (enforceIndexIdentity) and src/search.ts L1368, L1716, L1990, L2441, L2502 — every one passes `activeModelSpec(this.settings)` / the private `activeSpec()` getter from item 7. Update src/identity.test.ts (it imports the deleted constants; build identities from ACTIVE_MODEL_SPEC instead).
5. src/sidecar-meta.ts expectationFor(id): make `id` required (no pluginIdentity() default). Fix all callers (src/search.ts L2487, 2593, 2684, 3004, 4156 per inventory; grep to be sure).
6. src/index-store.ts L611 fabricated default meta (empty store only): the IndexStore constructor takes an explicit `defaultEmbeddingDim: () => number` provider and getMeta() calls it; remove the model-registry import. A lazy provider, not a number, because src/main.ts L133 constructs the store as a class field BEFORE settings load, and the dim must follow a later model switch. Construction sites (all four): src/main.ts L133 → `new IndexStore(() => activeModelSpec(this.settings).dim)`; src/test-harness/scenario.ts L83, bench/harness/page.ts L54, e2e/harness/page.ts L86 → `new IndexStore(() => ACTIVE_MODEL_SPEC.dim)`.
7. src/search.ts: replace every EMBEDDING_DIM / MODEL_ID read (L510, 689, 1396, 1498, 1706, 1720-1721, 1846, 1992, 2443, 2503, 4838 per inventory) with a private getter `activeSpec()` = activeModelSpec(this.settings). The two meta stamps that read `this.embedder.modelId` (L513, L1399) switch to `this.activeSpec().key` — the embedder may be unloaded (hydrate-only paths) and its modelId is '' before a load after this ticket. The drift guard at L1848 (`metaModel !== this.embedder.modelId`, gated on embedder.loaded) compares to `this.activeSpec().key` instead; keep the `loaded` gate to avoid a behavior change. Note L3487's bytesPerVec-vs-queryVec guard already uses live values — keep.
8. src/main.ts: ensureModelLoaded (L944-1106): `this.embedder.load(spec, requestedDevice)`; delete the spec.dim !== EMBEDDING_DIM guard (L999-1002) and every LOCAL_MODEL branch; delete the resolveOverrideSpec carve-out in enforceIndexIdentity (L1154); pluginIdentity(activeModelSpec(this.settings)) at L1173/1183; warnOnModelIndexDrift compares meta.modelId with activeModelSpec(this.settings).key.
9. Out-of-src caller of the old load signature: ONLY bench/harness/page-common.ts L78 (e2e/harness/page.ts reuses its loadModel helper) → `embedder.load(ACTIVE_MODEL_SPEC, device)`. Grep `embedder.load(` across src, bench, e2e to confirm nothing else.
10. src/dim-consistency.test.ts imports EMBEDDING_DIM — switch it to ACTIVE_MODEL_SPEC.dim (ticket 2/6 rewrites the sidecar part). src/iframe-runner.test.ts's literal 384 stays until 3/6.

ACCEPTANCE: `npm run typecheck` clean; `npm run test` green (redirect output to .tmp/); new tests for modelKeyFor, activeModelSpec with an override, migration rev 11; a test asserting activeModelSpec(DEFAULT_SETTINGS).key === 'tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX' AND that pluginIdentity(ACTIVE_MODEL_SPEC) equals the identity the pre-change code produced (pin the full object {modelId, revision, dim} literally in the test BEFORE refactoring — the no-reindex-on-upgrade guarantee). Also `npm run build` succeeds (esbuild catches the removed exports in bench/e2e harness code that tsc may not cover). Update src/CLAUDE.md §Layers one-liner for model-registry.ts (identity now runtime) — succinct. Record a change_log entry at the end.

