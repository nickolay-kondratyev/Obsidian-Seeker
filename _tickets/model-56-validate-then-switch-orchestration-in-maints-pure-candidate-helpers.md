---
id: nid_dfmajhegs6mapfmu6i4l7uy5t_e
title: "Model 5/6: validate-then-switch orchestration in main.ts + pure candidate helpers"
status: open
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e, nid_mny8ao7h45fiyiplclnl8ad68_e, nid_avq9wmbcrqb3k8c3clknc8gv5_e, nid_89jwpyh0t0j1cncxsn5u2n2ih_e, nid_raiqgnyuva8ex6rt6p2ldtyya_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T20:25:50Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [model]
---

Model 5/6 — Validate-then-switch orchestration in src/main.ts + pure candidate helpers. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md ("Validate → Switch"). Depends on 1/6, 2/6, 3/6, 4/6.

CONTEXT (inventory): src/main.ts — ensureModelLoaded L944-1106 (loads activeModelSpec(settings) via this.embedder.load; then navigator.storage.persist, evictStaleModelCaches(caches, spec.repo) L1067 — i.e. every non-active repo's bytes are evicted after EACH cold load; model-delivery log L1071-1080); prewarmModel L907; runFullReindex(opts?: { skipConfirm?, onProgress? }) L2009 (refuses while orchestrator.isWriting(); shows ConfirmModal unless skipConfirm; calls ensureModelLoaded itself); getModelStatus L2145 + ModelStatus { downloaded, persisted, name, dim } L124-129; deleteModel L2178; `private embedder = new LocalEmbedder()` L132 (no ctor args); `get isIndexing` L265; `modelDriftWarned` L1136; settings are mutated IN PLACE (never reassigned — the orchestrator shares the reference). Obsidian's requestUrl is available for the pooling-config fetch (it has NO timeout option and throws on non-2xx unless `throw: false`). Two LocalEmbedders can coexist: IframeRunner's IFRAME_ID (src/iframe-runner.ts L119/L336) is cosmetic (set, never queried) and each runner's message listener filters on its own contentWindow. Existing pure helpers + tests live in src/model-registry.ts / .test.ts. Cross-device semantics: plan section "Cross-device behavior" (consent-gated; no auto-reindex on peers).

CHANGES
1. New pure module src/model-candidate.ts (+ .test.ts), Obsidian-free:
   - `isValidHfSlug(s): boolean` — `^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$`, trims; rejects URLs, spaces, missing owner.
   - `poolingConfigUrl(repo, revision | null): string` → https://huggingface.co/<repo>/resolve/<rev ?? 'main'>/1_Pooling/config.json.
   - `revisionInfoUrl(repo, revision | null): string` → https://huggingface.co/api/models/<repo>/revision/<rev ?? 'main'> (HF Hub API; the JSON has a top-level `sha` field = the resolved commit).
   - `parseRevisionSha(json: unknown): string | null` — returns `sha` when it is a 40-char lowercase hex string, else null. Pure, unit-tested (valid; missing; short; uppercase → null).
   - `parsePoolingConfig(json: unknown): Pooling | null` — pooling_mode_cls_token true → 'cls'; pooling_mode_mean_tokens true → 'mean'; anything else/invalid → null.
   - `PROBE_SENTENCE` constant + `checkProbeVector(vec: Float32Array): string | null` (null = ok; else plain-language reason: empty, non-finite, not unit-norm within 1e-2).
   - `describeModelLoadError(raw: string): string` — maps the common transformers.js failures to plain language (404 on model file → "the repo has no onnx/<file> for dtype X; try another dtype", 401/403 → gated/private repo, network → offline) and always appends the raw error in parentheses.
2. New Obsidian-free module src/model-validate.ts (+ .test.ts) — the validation ORCHESTRATION, testable without a Plugin:
   - `export type ModelCandidate = Omit<ModelOverride, 'dim'>`; `export type ModelValidation = { ok: true; dim: number; dtype: Dtype; device: Device } | { ok: false; error: string }`.
   - `export type CandidateEmbedder = Pick<LocalEmbedder, 'load' | 'embed' | 'dim' | 'dtype' | 'device' | 'teardown'>`.
   - `export type ModelValidation = { ok: true; dim: number; dtype: Dtype; device: Device; revision: string } | { ok: false; error: string }` — `revision` is the PINNED sha the switch must store (decision 2026-09-03: an override never tracks `main`; see plan).
   - `export class ModelCandidateValidator { constructor(private readonly newEmbedder: () => CandidateEmbedder, private readonly resolveRevision: (repo: string, revision: string | null) => Promise<string | null>) {} async validate(c: ModelCandidate, device: RequestedDevice): Promise<ModelValidation> }`: (1) isValidHfSlug else { ok:false }; (2) `const sha = await this.resolveRevision(c.repo, c.revision)`; null → { ok:false, error: 'Could not resolve the model revision on Hugging Face (offline, or the repo/branch does not exist).' } — NO embedder is constructed; (3) `const e = this.newEmbedder()`; try { load({ ...c, revision: sha, key: modelKeyFor(c), dim: null }, device) (ModelLoadSpec from 1/6/3/6 — null = detect; loading by sha means the bytes validated are the bytes pinned); embed(PROBE_SENTENCE) → checkProbeVector; return { ok:true, dim: e.dim, dtype: e.dtype, device: e.device, revision: sha } } catch → { ok:false, error: describeModelLoadError(String(err)) } finally { e.teardown() }. A user-typed revision (tag/branch/sha) is resolved the same way — a sha resolves to itself.
   - Tests with a stub CandidateEmbedder + stub resolveRevision: happy path returns the stub's dim/dtype/device and the resolved sha, and the load call received `revision: sha`; unresolvable revision → ok:false and no embedder constructed; load rejection → ok:false with the described error; bad probe vector → ok:false; teardown is called on every path (incl. throw); invalid slug never constructs an embedder.
3. src/main.ts (thin wiring):
   - `async detectPooling(repo, revision): Promise<Pooling | null>` — `requestUrl({ url: poolingConfigUrl(...), throw: false })` raced against a 5 s `window.setTimeout` (popout convention: window.setTimeout, never bare setTimeout); status 200 → parsePoolingConfig(resp.json); anything else / throw → null. Best-effort, never throws.
   - `async resolveRevisionSha(repo, revision): Promise<string | null>` — `requestUrl({ url: revisionInfoUrl(...), throw: false })` raced against the same 5 s window.setTimeout; status 200 → parseRevisionSha(resp.json); else null. Never throws.
   - `validateModelCandidate(c) = new ModelCandidateValidator(() => new LocalEmbedder(), (r, rev) => this.resolveRevisionSha(r, rev)).validate(c, resolveDevice())`, then log a 'model-validate' entry (extend the log schema in src/types.ts: ok/dim/dtype/device/revision/error/repo). The active embedder and the index are untouched. Known benign side effects (document in code): the throwaway load overwrites the single localStorage warmup fingerprint (active model re-warms once on its next cold load) and leaves the candidate's bytes in the Cache API until the next active-model load evicts non-active repos.
   - `async switchModel(next: ModelOverride | null, onProgress?): Promise<boolean>` — ORDER MATTERS: (a) isMobilePlatform() → Notice 'Change the model from a desktop device' + return false; (b) isIndexing || orchestrator.isWriting() → Notice + return false — BEFORE saving (a saved new identity with no reindex would strand this device on the stale-index banner); (c) `this.settings.modelOverride = next ?? undefined` (in place; delete the key when null so data.json stays clean) + saveSettings(); (d) this.modelDriftWarned = false; (e) this.embedder.teardown(); (f) return runFullReindex({ skipConfirm: true, onProgress }). No explicit eviction: runFullReindex → ensureModelLoaded evicts every non-active repo after the new model loads (L1067).
   - getModelStatus: name = spec.repo (full slug), add `pooling` and `isOverride: boolean`; deleteModel/probe use the dtype→filename mapping from 1/6.
4. Tests: src/model-candidate.test.ts covers every pure helper (slug accept/reject table incl. URLs / spaces / missing owner / leading dot; parsePoolingConfig truth table incl. both-true and neither; checkProbeVector; describeModelLoadError cases). src/model-validate.test.ts covers the validator as in item 2. switchModel itself is Plugin-bound and is verified manually in 6/6 (its ordering guard is the only logic; keep it small).

ACCEPTANCE: typecheck + `npm run test` green; change_log entry.

