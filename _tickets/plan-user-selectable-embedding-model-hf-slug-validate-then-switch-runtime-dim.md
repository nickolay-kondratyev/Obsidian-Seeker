---
closed_iso: 2026-09-03T20:26:08Z
id: nid_uf0gnfjac87y3qls9mymlq5hj_e
title: "Plan: user-selectable embedding model (HF slug, validate-then-switch, runtime dim)"
status: closed
deps: []
links: [nid_s0rj0qtgibopdgr3tgvvkusad_e]
created_iso: 2026-09-03T20:23:42Z
status_updated_iso: 2026-09-03T20:26:08Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [plan, model]
---

PLAN OF RECORD — user-selectable embedding model (Hugging Face slug) with validate-then-switch and full reindex.
Origin ticket: nid_s0rj0qtgibopdgr3tgvvkusad_e ("Add support for other models"). Interview outcome (2026-09-03, human-confirmed):
- HF slug only (no local folder, no arbitrary URL). KISS, no follow-up.
- Runtime embedding dimension, detected from the model itself (probe embed). No Matryoshka slicing in v1.
- All three correctness knobs ship: pooling (cls|mean, auto-detected from the repo's 1_Pooling/config.json as a prefill), dtype (q4|q8|fp32), query/document text prefixes.
- UI: default settings view unchanged; an "Advanced model settings" disclosure inside "Model & performance" holds the override.
- Switching is destructive (index deleted, full reindex) → validate the new model BEFORE touching anything, then an explicit in-tab confirm. Old-model indexes are NOT kept.

## Why (context a fresh agent needs)
Today the model is a compile-time constant: src/model-registry.ts ML97_GBQ4 (tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX, 384-d, CLS pooling, dtype q4, pinned revision) → src/embedder.ts exports MODEL_ID / MODEL_REVISION / EMBEDDING_DIM as module constants → consumed by src/identity.ts (index version identity), src/sidecar.ts (record stride Q_BYTES/SIGN_BYTES), src/sidecar-meta.ts (cross-device gate), src/index-store.ts (default meta), src/search.ts (~12 sites), src/main.ts, src/iframe-runner.ts (OUTPUT_DIM templated into the child script; pooling 'cls' hardcoded at 6 call sites). A debug-only data.json override (SeekerSettings.modelRepoOverride/modelRevisionOverride) exists but assumes 384-d/q4/CLS and is carved out of the identity heal cascade (src/main.ts enforceIndexIdentity). History: a per-vault model choice existed 2026-06-10..11 and was removed because a wrong value silently degrades ranking (src/embedder.ts ~L100). This plan re-adds a choice deliberately, with validate-before-switch and identity stamping so a wrong/changed value can never be silently mixed with an old index.

## Target data model
src/types.ts:
  export type Pooling = 'cls' | 'mean';
  export interface ModelOverride { repo: string; revision: string | null; dim: number; pooling: Pooling; dtype: Dtype; queryPrefix: string; docPrefix: string; }
  SeekerSettings.modelOverride?: ModelOverride   // absent = shipped default. SYNCED via data.json on purpose: every device's index identity follows it (see "Cross-device behavior" below for what peers actually do).
  settingsRev 10 → 11: drop the debug fields modelRepoOverride / modelRevisionOverride (no conversion: their dim/pooling are unknowable).
src/model-registry.ts ModelSpec gains: pooling: Pooling; queryPrefix: string; docPrefix: string. ML97_GBQ4: pooling 'cls', prefixes ''. `files` list is dropped from the spec (only ever documentation + the .onnx probe; probe by dtype→filename instead).
  key (index drift identity; stored as meta.modelId and sidecar meta.modelId) = repo for the shipped default; for an override key = `${repo}|pool=${pooling}|doc=${docPrefix}` (built by ONE pure function modelKeyFor). revision and dim are deliberately NOT folded into the key: IndexIdentity (src/identity.ts identityMatches) and the sidecar MetaExpectation (src/sidecar-meta.ts metaAccepts) already carry and compare `revision` and `dim` as their own fields, so a revision or dim change is caught there without duplicating it in the string. dtype is NOT part of identity (the WebGPU ladder already mixes q4/fp32 vectors across devices today; same policy). queryPrefix is NOT part of identity (query-side only, no stored vectors change).
  activeModelSpec(settings): settings.modelOverride ? spec from override : ACTIVE_MODEL_SPEC. resolveOverrideSpec is deleted.

## Identity + storage (runtime, no compile-time model constants)
- Delete MODEL_ID / MODEL_REVISION / EMBEDDING_DIM exports from src/embedder.ts. Keep LEGACY_ENGLISH_MODEL_ID (legacy unstamped-index classifier).
- src/identity.ts: pluginIdentity(spec: ModelSpec); identityHealEligibility(meta, live) with live REQUIRED (no defaulted constant). meta.modelId stores spec.key.
- src/sidecar-meta.ts expectationFor(id) — callers pass pluginIdentity(spec) explicitly; no defaulted arg.
- src/search.ts SearchOrchestrator already receives `settings`; it derives `activeModelSpec(this.settings)` where a constant was read (stamps, Float64Array(dim) background sums, modelId comparisons).
- src/sidecar.ts record layout becomes a function of dim (recordLayout(dim)); records already carry `dim` per jsonl entry and meta.dim gates cross-dim hydration. Byte layout for 384 is unchanged → no SIDECAR_FORMAT bump.
- src/index-store.ts default meta uses the active spec's dim (pass dim into the store or the getMeta default).
- The cold-boot identity gate (src/main.ts enforceIndexIdentity, runs BEFORE any model load, gates mobile boot) keeps working because the spec is derived from settings alone — no embedder needed. The debug-override carve-out is deleted.
- Model-vs-index drift (src/main.ts warnOnModelIndexDrift) compares meta.modelId against activeModelSpec(settings).key (not the load base repo).
- src/index-store.ts must not import model-registry: the IndexStore constructor takes an explicit `defaultEmbeddingDim: () => number` provider (main: `() => activeModelSpec(this.settings).dim`; harnesses/bench: `() => ACTIVE_MODEL_SPEC.dim`) used ONLY for the fabricated meta of an empty store. A lazy provider (not a number) because main constructs the store as a field before settings are loaded and the dim must follow a later switch.

## Cross-device behavior (verified against src/main.ts enforceIndexIdentity, 2026-09-03 — READ before writing any user-facing copy)
- The identity cascade is CONSENT-GATED since 2026-06-23: NO device auto-reindexes on an identity mismatch. Order on a peer: (1) hydrate embed-free from a peer sidecar whose meta matches the new identity (the switching desktop publishes one at the end of its full reindex, when the sidecar is enabled) → (2) embed-free in-place heal (n/a for a model change: 'stale') → (3) otherwise mark the index version-stale and show the search-modal banner: 'syncing' when some peer sidecar exists (it will hydrate later), else the 'index stale — Reindex' banner + toast. Mobile never bulk-embeds (it waits for a sidecar). With the sidecar DISABLED only the legacy warn-only Notice (warnOnModelIndexDrift) fires at model-load time.
- Peers read data.json only at plugin load (no onExternalSettingsChange handler today — follow-up ticket nid_hsgc2h9mt5yv0ib951qedlllh_e). Until a peer reloads the plugin it keeps embedding with the OLD model under the OLD identity; its sidecar stays old-identity and is refused by the switching device (metaAccepts). No corruption, only delayed convergence. probePeerAhead keys on chunkerVersion only, so the stale-settings peer does NOT get a wrong "update Seeker" banner.
- Every device downloads the new model on its first search after the switch (size varies by model; phones included). The confirm copy must say so.
- UI copy consequence: never say "other devices rebuild automatically". Say: "Other devices sync the new index from this one (sidecar on) or show a reindex banner; each downloads the new model on its next search."


## Runtime (iframe + embedder)
- LoadRequest gains `pooling: Pooling` and `outputDim: number | null` (null = detect). OUTPUT_DIM is no longer templated into the child script (buildChildScript(cdnUrl) only). The child keeps mutable `outputDim` / `pooling` state that is RESET on every load from the payload (the child script is built once per iframe at IframeRunner init and a runner can be loaded again after recycle). Right after the pipeline is created — on BOTH the WebGPU and the WASM path (the WASM path has no warmup/probe pass today, so do not piggy-back on probeForwardMs, which is diagnostic and swallows errors) — one dedicated `detectOutputDim()` forward pass on a short probe text reads `output.dims[output.dims.length - 1]`: when the requested outputDim is null it becomes the measured width; when non-null and ≠ measured → the load fails loud with a plain-language error ('model produced N-d vectors, expected M-d'). LoadResult gains `dim: number` (measured). The embed guards then compare against the child's `outputDim` (equality, not `<`).
- One shared child helper embedOpts(maxLength) replaces the six inline `{ pooling: 'cls', normalize: true, ... }` objects (src/iframe-runner.ts ~855, 923, 937, 1094, 1132, 1211).
- warmupFingerprint gains pooling. Query-embed LRU is cleared on every load (already) — sufficient.
- dtype: user's choice is passed through as today; the WebGPU ladder already tries [requested, q4, fp32]; the WASM path has no fallback (a missing onnx/model_<dtype>.onnx fails loud with the transformers.js error — acceptable, surfaced by Validate).
- LocalEmbedder.load(spec: ModelLoadSpec, requested: RequestedDevice) replaces the (requested, dtype, modelIdOverride?, revision?) signature, where `export type ModelLoadSpec = Omit<ModelSpec, 'dim'> & { dim: number | null }` (src/model-registry.ts; a ModelSpec is assignable to it). dim null = "detect, don't check" and is used ONLY by candidate validation — no numeric sentinel. `LocalEmbedder.dim` exposes the measured width after a load. The Phase-5 LOCAL_MODEL dev toggle (vault-folder model) is REMOVED — it contradicts "HF slug only" and complicates load(); git history keeps it.
- Prefixes: docPrefix prepended inside src/token-budget.ts embedInput(chunk, docPrefix) (the single source for both token counting and embedding; the prefix's tokens count against the 512 budget like denseSuffix does). queryPrefix prepended at the query embed in src/search.ts search() (after cleanDenseText). 512-token budget and seq buckets stay fixed (follow-up per src/CLAUDE.md §Chunking).

## Validate → Switch (desktop only)
- Mobile: the disclosure shows the active model read-only with "Change the model from a desktop device" (mobile never bulk-embeds by design; the synced setting + identity cascade brings the new index to mobile).
- Validation lives in an Obsidian-free module src/model-validate.ts (class ModelCandidateValidator, constructor takes an embedder FACTORY `() => CandidateEmbedder` where CandidateEmbedder = Pick<LocalEmbedder, 'load' | 'embed' | 'dim' | 'teardown'>; main.ts passes `() => new LocalEmbedder()`). validate(candidate, device): (1) slug shape `^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$`; (2) load the candidate in a THROWAWAY embedder (its own iframe — IframeRunner's IFRAME_ID is cosmetic, never queried, and each runner filters messages by its own contentWindow, so two iframes coexist) with dim null; (3) embed a fixed probe sentence; (4) check vector length > 0, finite, unit-norm; (5) teardown in `finally`; return { ok:true, dim, dtype, device } or { ok:false, error: plain-language message + the raw error }. Nothing is deleted or saved. Unit-tested with a stub embedder (happy path, load failure, bad vector, teardown-always). Known benign side effects: the throwaway load overwrites the single localStorage warmup fingerprint (the active model re-warms once, ~1 s, on its next cold load) and leaves the candidate's bytes in the Cache API until the next active-model load evicts non-active repos.
- Pooling prefill: when the repo/revision field changes, fetch https://huggingface.co/<repo>/resolve/<rev|main>/1_Pooling/config.json via Obsidian requestUrl (best-effort, ≤5 s); parse pooling_mode_cls_token / pooling_mode_mean_tokens (pure parser, unit-tested); set the Pooling dropdown and show "detected from repo". Absent/failed → leave the dropdown ('mean' default for overrides; the shipped default is CLS) and show "not declared by repo — pick manually".
- switchModel(next: ModelOverride | null) in src/main.ts: mobile → refuse; refuse while indexing (orchestrator.isWriting / isIndexing) BEFORE saving anything (a saved identity with no reindex would strand this device on the stale banner); then save settings (null = reset to shipped default; mutate this.settings in place — the orchestrator shares the reference); modelDriftWarned = false; embedder.teardown(); runFullReindex({ skipConfirm: true, onProgress }). No explicit eviction call: runFullReindex → ensureModelLoaded already evicts every non-active repo after the new model loads. The in-tab two-step confirm (same pattern as "Delete & reindex" / "Delete model") states: which model, index deletion, note count, model download on this and every other device, and the peer behavior from "Cross-device behavior".

## UI (src/settings-tab.ts, "Model & performance")
Row "Embedding model" (existing status: downloaded/size/Delete/Download now) gets model-agnostic copy (no "≈100 MB" literal; show repo name · dim · pooling). New disclosure "Advanced model settings" (same seeker-disclosure pattern + its own open-state field): Repo (text, placeholder owner/name), Revision (text, empty = main), Pooling (dropdown CLS/Mean + detected hint), Dtype (dropdown q4/q8/fp32), Query prefix (text), Document prefix (text), buttons: Validate → shows result line (dim, backend, dtype) → Switch model & reindex (warning, enabled only after a successful validate for the exact current field values) → Cancel / confirm. "Reset to default model" (visible only when an override is active) → same confirm → switchModel(null). Field edits are local tab state until Switch (settings are NOT saved on keystroke — saving would change identity on all devices). The existing "Reset to defaults" (all settings) uses Object.assign(this.s, DEFAULT_SETTINGS), which leaves `modelOverride` untouched because DEFAULT_SETTINGS has no such key — that is the WANTED behavior (a reset must never silently change the index identity); make it explicit in that row's copy ("does not change the embedding model").

## Tickets (execution order; deps encoded)
1. Runtime ModelSpec + settings schema + identity/search/main plumbing (removes compile-time constants).
2. Sidecar record layout parameterized by dim.
3. Iframe/embedder: pooling + dim detection + load signature.
4. Query/document prefixes.
5. Validate + switch orchestration (main.ts) + pure candidate helpers.
6. Settings UI + docs + final gates (typecheck, unit, build, e2e retrieval gate, bench sanity).
Out of scope (deliberately): local/URL models, Matryoshka slicing, per-model token budget, curated model dropdown, keeping old-model indexes. Follow-up (separate ticket, after 6/6): apply a synced model change without a plugin reload — nid_hsgc2h9mt5yv0ib951qedlllh_e.
DECIDED 2026-09-03 (human): Validate PINS the resolved commit sha. An override never tracks `main`: when the Revision field is empty, Validate resolves the branch head via the HF API and stores the 40-char sha in modelOverride.revision, so every device on every day loads identical bytes and an index can never mix embeddings from two versions of one repo. Upgrading a model is a deliberate re-Validate + Switch. (A "newer revision available" hint is NOT in scope.) Details in tickets 5/6 and 6/6.


## Notes

**2026-09-03T20:30:29Z**

Implementation ticket ids/paths (all depend on this plan; order = deps):
- 1/6 nid_mny8ao7h45fiyiplclnl8ad68_e _tickets/model-16-runtime-modelspec-settings-schema-identitysearchmain-plumbing.md
- 2/6 nid_avq9wmbcrqb3k8c3clknc8gv5_e _tickets/model-26-sidecar-record-layout-parameterized-by-embedding-dim.md (dep 1)
- 3/6 nid_89jwpyh0t0j1cncxsn5u2n2ih_e _tickets/model-36-iframeembedder-pooling-option-dimension-detection-load-payload.md (dep 1)
- 4/6 nid_raiqgnyuva8ex6rt6p2ldtyya_e _tickets/model-46-query-and-document-text-prefixes.md (dep 1)
- 5/6 nid_dfmajhegs6mapfmu6i4l7uy5t_e _tickets/model-56-validate-then-switch-orchestration-in-maints-pure-candidate-helpers.md (deps 1-4)
- 6/6 nid_1zqy3m0wb155p2hidgz4z1pka_e _tickets/model-66-advanced-model-settings-ui-docs-final-gates.md (dep 5)
Origin ticket: nid_s0rj0qtgibopdgr3tgvvkusad_e (closed; holds the interview record).

**2026-09-03T20:41:08Z**

Reviewed 2026-09-03 for logical soundness against the code (base 554a573). Corrections applied in place: (1) cross-device claim fixed — the cascade is consent-gated, new section "Cross-device behavior"; (2) modelKeyFor excludes revision (identity/sidecar meta compare it separately); (3) ModelLoadSpec { dim: number | null } replaces the dim-0 sentinel; (4) dim detection = dedicated detectOutputDim() pass on webgpu AND wasm paths, child state reset per load; (5) validation orchestration in Obsidian-free src/model-validate.ts with an injected embedder factory (unit-testable); (6) IndexStore gets a lazy defaultEmbeddingDim provider; (7) switchModel refuses BEFORE saving, no explicit evict (ensureModelLoaded evicts); (8) Reset-to-defaults copy; (9) unrunnable gates must be reported, not skipped. Follow-up created: nid_hsgc2h9mt5yv0ib951qedlllh_e (apply synced model change without reload, dep on 6/6).

**2026-09-03T20:46:00Z**

2026-09-03 HUMAN decided Q1: Option B — Validate pins the resolved commit sha (an override never tracks main). Applied to tickets 5/6 and 6/6.
