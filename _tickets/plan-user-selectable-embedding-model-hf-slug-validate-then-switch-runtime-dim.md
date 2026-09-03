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
  SeekerSettings.modelOverride?: ModelOverride   // absent = shipped default. SYNCED via data.json on purpose: every device's index identity follows it and the existing sidecar/identity cascade (hydrate from a peer with the same model, else desktop auto full-reindex / mobile wait) does the cross-device work.
  settingsRev 10 → 11: drop the debug fields modelRepoOverride / modelRevisionOverride (no conversion: their dim/pooling are unknowable).
src/model-registry.ts ModelSpec gains: pooling: Pooling; queryPrefix: string; docPrefix: string. ML97_GBQ4: pooling 'cls', prefixes ''. `files` list is dropped from the spec (only ever documentation + the .onnx probe; probe by dtype→filename instead).
  key (index drift identity) = repo for the shipped default; for an override key = `${repo}|rev=${revision ?? 'main'}|pool=${pooling}|doc=${docPrefix}` (built by ONE pure function modelKeyFor(spec)). dtype is NOT part of identity (the WebGPU ladder already mixes q4/fp32 vectors across devices today; same policy). queryPrefix is NOT part of identity (query-side only, no stored vectors change).
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

## Runtime (iframe + embedder)
- LoadRequest gains `pooling: Pooling` and `outputDim: number | null` (null = detect). OUTPUT_DIM is no longer templated into the child script (buildChildScript(cdnUrl) only); the child keeps a mutable `outputDim` set from the load payload or detected from the first real forward pass (probeForwardMs already runs one and discards the tensor — read output.dims there). LoadResult gains `dim: number` (detected). Parent: if a spec dim was given and the detected dim differs → load fails loud (never index into a wrong-dim store).
- One shared child helper embedOpts(maxLength) replaces the six inline `{ pooling: 'cls', normalize: true, ... }` objects (src/iframe-runner.ts ~855, 923, 937, 1094, 1132, 1211).
- warmupFingerprint gains pooling. Query-embed LRU is cleared on every load (already) — sufficient.
- dtype: user's choice is passed through as today; the WebGPU ladder already tries [requested, q4, fp32]; the WASM path has no fallback (a missing onnx/model_<dtype>.onnx fails loud with the transformers.js error — acceptable, surfaced by Validate).
- LocalEmbedder.load(spec: ModelSpec, requested: RequestedDevice) replaces the (requested, dtype, modelIdOverride?, revision?) signature. The Phase-5 LOCAL_MODEL dev toggle (vault-folder model) is REMOVED — it contradicts "HF slug only" and complicates load(); git history keeps it.
- Prefixes: docPrefix prepended inside src/token-budget.ts embedInput(chunk, docPrefix) (the single source for both token counting and embedding; the prefix's tokens count against the 512 budget like denseSuffix does). queryPrefix prepended at the query embed in src/search.ts search() (after cleanDenseText). 512-token budget and seq buckets stay fixed (follow-up per src/CLAUDE.md §Chunking).

## Validate → Switch (desktop only)
- Mobile: the disclosure shows the active model read-only with "Change the model from a desktop device" (mobile never bulk-embeds by design; the synced setting + identity cascade brings the new index to mobile).
- validateModelCandidate(candidate) in src/main.ts: (1) slug shape `^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$`; (2) load the candidate in a THROWAWAY LocalEmbedder (own iframe; the active model stays untouched) with outputDim null; (3) embed a fixed probe sentence; (4) check vector length > 0, finite, unit-norm; (5) teardown; return { ok, dim, dtypeUsed, device } or { ok:false, error: plain-language message + the raw error }. Nothing is deleted or saved.
- Pooling prefill: when the repo/revision field changes, fetch https://huggingface.co/<repo>/resolve/<rev|main>/1_Pooling/config.json via Obsidian requestUrl (best-effort, ≤5 s); parse pooling_mode_cls_token / pooling_mode_mean_tokens (pure parser, unit-tested); set the Pooling dropdown and show "detected from repo". Absent/failed → leave the dropdown ('mean' default for overrides; the shipped default is CLS) and show "not declared by repo — pick manually".
- switchModel(next: ModelOverride | null): refuse while indexing; save settings (null = reset to shipped default); embedder.teardown(); evictStaleModelCaches(caches, newSpec.repo); runFullReindex({ skipConfirm: true, onProgress }) (its ensureModelLoaded reads activeModelSpec). The in-tab two-step confirm (same pattern as "Delete & reindex" / "Delete model") states: which model, index deletion, note count, download, and that other devices rebuild too.

## UI (src/settings-tab.ts, "Model & performance")
Row "Embedding model" (existing status: downloaded/size/Delete/Download now) gets model-agnostic copy (no "≈100 MB" literal; show repo name · dim · pooling). New disclosure "Advanced model settings" (same seeker-disclosure pattern + its own open-state field): Repo (text, placeholder owner/name), Revision (text, empty = main), Pooling (dropdown CLS/Mean + detected hint), Dtype (dropdown q4/q8/fp32), Query prefix (text), Document prefix (text), buttons: Validate → shows result line (dim, backend, dtype) → Switch model & reindex (warning, enabled only after a successful validate for the exact current field values) → Cancel / confirm. "Reset to default model" (visible only when an override is active) → same confirm → switchModel(null). Field edits are local tab state until Switch (settings are NOT saved on keystroke — saving would change identity on all devices).

## Tickets (execution order; deps encoded)
1. Runtime ModelSpec + settings schema + identity/search/main plumbing (removes compile-time constants).
2. Sidecar record layout parameterized by dim.
3. Iframe/embedder: pooling + dim detection + load signature.
4. Query/document prefixes.
5. Validate + switch orchestration (main.ts) + pure candidate helpers.
6. Settings UI + docs + final gates (typecheck, unit, build, e2e retrieval gate, bench sanity).
Out of scope (deliberately): local/URL models, Matryoshka slicing, per-model token budget, curated model dropdown, keeping old-model indexes.

