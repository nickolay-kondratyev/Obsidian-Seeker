---
id: nid_89jwpyh0t0j1cncxsn5u2n2ih_e
title: "Model 3/6: iframe/embedder pooling option + dimension detection + load payload"
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

Model 3/6 — Iframe/embedder runtime: pooling option, dimension detection, load payload. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md ("Runtime (iframe + embedder)"). Depends on 1/6.

CONTEXT (inventory): src/iframe-runner.ts. buildChildScript(cdnUrl, outputDim) at L486 templates OUTPUT_DIM into the child script (L612), called once at L350 with the compiled dim. The child hardcodes `pooling: 'cls', normalize: true` at six independent call sites: probeForwardMs L855, loadModel warmup loop L923 and L937, embedText L1094, embedBatch L1132, profileRuntime L1211. Embed guards at L1101-1103 and L1140 throw if the model's real width < OUTPUT_DIM. probeForwardMs (L849-864) runs a real forward pass after warmup and discards the output tensor. LoadRequest (L474-481) = { modelId, device, dtype, skipWarmup, revision?, warmupGrid }; child dispatch at L1283-1291. LoadResult has no dim. The WebGPU ladder (L769-818) tries [requestedDtype, q4, fp32]; the WASM path (L1013-1071) passes the requested dtype through with no dtype fallback (acceptable; Validate surfaces the error). The child script is a template literal — NO backticks inside it. src/embedder.ts warmupFingerprint (L45) joins modelId|revision|dtype|TRANSFORMERS_VERSION|grid|buckets.

CHANGES
1. LoadRequest: add `pooling: Pooling` and `outputDim: number | null` (null = detect). LoadResult: add `dim: number` (the width the model actually produced).
2. buildChildScript(cdnUrl) — drop the outputDim parameter and the OUTPUT_DIM template. In the child: `let outputDim = null; let pooling = 'cls';` set from the load payload; after the first forward pass (extend probeForwardMs, or the first warmup cell, to read output.dims[last]) set outputDim when null, and when a non-null outputDim was requested and differs from the measured width → throw a plain-language load error ('model produced N-d vectors, expected M-d'). Guards at L1101/L1140 compare against outputDim. sliceAndRenormalize stays but is a pass-through (no MRL slicing in v1).
3. One child helper `function embedOpts(maxLength) { return { pooling: pooling, normalize: true, padding: true, truncation: true, max_length: maxLength }; }` (match the exact option sets used today at the six sites; if a site differs, keep the difference explicit via a parameter) — replace all six inline objects.
4. src/embedder.ts: load(spec, requested) forwards pooling: spec.pooling, outputDim: spec.dim (or null when the caller passes a spec with dim 0 — used by validation in ticket 5/6; document this convention on the ModelSpec.dim field: 0 = unknown/detect). LoadEntry.embeddingDim = result.dim. warmupFingerprint gains pooling (add it to the joined array). Expose `get dim(): number` (detected) on LocalEmbedder.
5. Tests: src/iframe-runner.test.ts (buildChildScript(...,384) literal calls → new signature; assert the template no longer contains 'OUTPUT_DIM ='; assert the child source contains exactly one `pooling: pooling` occurrence and zero `pooling: 'cls'`); src/embedder.test.ts warmupFingerprint pooling case; a test that a load payload includes pooling + outputDim.

ACCEPTANCE: typecheck + unit tests green; `npm run build` succeeds; run `npm run bench` (docs/perf-bench.md) once as a smoke test that the real iframe still loads and embeds the default model on this machine (the bench is the only real-runtime exercise available outside e2e; note the result in the ticket). change_log entry.

