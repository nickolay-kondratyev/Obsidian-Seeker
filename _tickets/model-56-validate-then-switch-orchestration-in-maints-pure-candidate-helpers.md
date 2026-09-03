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

CONTEXT (inventory): src/main.ts — ensureModelLoaded L944-1106 (loads activeModelSpec(settings) via this.embedder.load; then navigator.storage.persist, evictStaleModelCaches(caches, spec.repo) L1067, model-delivery log L1071-1080); prewarmModel L907; runFullReindex(opts?: { skipConfirm?, onProgress? }) L2009 (shows ConfirmModal unless skipConfirm); getModelStatus L2145 + ModelStatus { downloaded, persisted, name, dim } L124-129; deleteModel L2178; `private embedder = new LocalEmbedder()` L132 (no ctor args); isIndexing flag used by the settings tab. Obsidian's requestUrl is available for the pooling-config fetch. Existing pure helpers + tests live in src/model-registry.ts / .test.ts.

CHANGES
1. New pure module src/model-candidate.ts (+ .test.ts), Obsidian-free:
   - `isValidHfSlug(s): boolean` — `^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$`, trims; rejects URLs, spaces, missing owner.
   - `poolingConfigUrl(repo, revision | null): string` → https://huggingface.co/<repo>/resolve/<rev ?? 'main'>/1_Pooling/config.json.
   - `parsePoolingConfig(json: unknown): Pooling | null` — pooling_mode_cls_token true → 'cls'; pooling_mode_mean_tokens true → 'mean'; anything else/invalid → null.
   - `probeSentence` constant + `checkProbeVector(vec: Float32Array): string | null` (null = ok; else plain-language reason: empty, non-finite, not unit-norm within 1e-2).
   - `describeModelLoadError(raw: string): string` — maps the common transformers.js failures to plain language (404 on model file → "the repo has no onnx/<file> for dtype X; try another dtype", 401/403 → gated/private repo, network → offline) and always appends the raw error in parentheses.
2. src/main.ts:
   - `async detectPooling(repo, revision): Promise<Pooling | null>` — requestUrl with a 5 s timeout, best-effort, never throws.
   - `async validateModelCandidate(c: ModelCandidate): Promise<ModelValidation>` where ModelCandidate = ModelOverride without dim, ModelValidation = { ok: true; dim; dtype; device } | { ok: false; error }. Uses a THROWAWAY `new LocalEmbedder()`: build a spec with dim 0 (= detect, convention from 3/6) via modelKeyFor; load(spec, resolveDevice()); embed(probeSentence) → checkProbeVector; read embedder.dim; ALWAYS teardown in finally. The active embedder and the index are untouched. Log a 'model-validate' entry (extend the log schema in src/types.ts) with ok/dim/dtype/device/error.
   - `async switchModel(next: ModelOverride | null, onProgress?): Promise<boolean>` — refuse (return false + Notice) if isIndexing or a reindex is running; set settings.modelOverride = next ?? undefined; saveSettings; this.modelDriftWarned = false; embedder.teardown(); evictStaleModelCaches(caches, activeModelSpec(settings).repo) best-effort; return runFullReindex({ skipConfirm: true, onProgress }). Desktop-only guard: if isMobilePlatform() → Notice 'Change the model from a desktop device' and return false.
   - getModelStatus: name = spec.repo (full slug), add `pooling` and `isOverride: boolean`; deleteModel/probe use the dtype→filename mapping from 1/6.
3. Tests: src/model-candidate.test.ts covers every pure helper (slug accept/reject table, parsePoolingConfig truth table, checkProbeVector, describeModelLoadError cases). For validateModelCandidate/switchModel, add a scenario test in src/test-harness/ if the harness supports a stub embedder (read src/test-harness/CLAUDE.md); otherwise document in the ticket that these are verified manually in 6/6.

ACCEPTANCE: typecheck + `npm run test` green; change_log entry.

