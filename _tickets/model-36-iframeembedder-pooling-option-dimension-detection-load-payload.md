---
closed_iso: 2026-09-03T21:21:53Z
session_ids: [{"a": "claude", "type": "execution", "id": "a213fea5-575c-44ef-97f9-e11ce0bc55db"}, {"a": "claude", "type": "review", "id": "f2877998-8961-47dc-a196-6ed73bf66c0e"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_89jwpyh0t0j1cncxsn5u2n2ih_e
title: "Model 3/6: iframe/embedder pooling option + dimension detection + load payload"
status: closed
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e, nid_mny8ao7h45fiyiplclnl8ad68_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T21:21:53Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [model]
profile: higher
---

Model 3/6 — Iframe/embedder runtime: pooling option, dimension detection, load payload. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md ("Runtime (iframe + embedder)"). Depends on 1/6.

CONTEXT (inventory): src/iframe-runner.ts. buildChildScript(cdnUrl, outputDim) at L486 templates OUTPUT_DIM into the child script (L612), called once at L350 with the compiled dim. The child hardcodes `pooling: 'cls', normalize: true` at six independent call sites: probeForwardMs L855, loadModel warmup loop L923 and L937, embedText L1094, embedBatch L1132, profileRuntime L1211. Embed guards at L1101-1103 and L1140 throw if the model's real width < OUTPUT_DIM. probeForwardMs (L849-864) runs a real forward pass after warmup and discards the output tensor. LoadRequest (L474-481) = { modelId, device, dtype, skipWarmup, revision?, warmupGrid }; child dispatch at L1283-1291. LoadResult has no dim. The WebGPU ladder (L769-818) tries [requestedDtype, q4, fp32]; the WASM path (L1013-1071) passes the requested dtype through with no dtype fallback (acceptable; Validate surfaces the error). The child script is a template literal — NO backticks inside it. src/embedder.ts warmupFingerprint (L45) joins modelId|revision|dtype|TRANSFORMERS_VERSION|grid|buckets.

CHANGES
1. LoadRequest: add `pooling: Pooling` and `outputDim: number | null` (null = detect). LoadResult: add `dim: number` (the width the model actually produced).
2. buildChildScript(cdnUrl) — drop the outputDim parameter, the OUTPUT_DIM template and the L350 `ACTIVE_MODEL_SPEC.dim` argument (iframe-runner.ts must no longer import model-registry). In the child: `let outputDim = null; let pooling = 'cls';` — RESET at the top of loadModel from the payload on EVERY load (the child script is built once per iframe; a runner is loaded again after recycle()). Add `async function detectOutputDim(requested)`: one forward pass `pipeline(['probe'], embedOpts(QUERY_SEQ_BUCKETS[0]))`, read `output.dims[output.dims.length - 1]`, dispose the tensor; if requested is null → outputDim = measured; else if measured !== requested → throw new Error('model produced ' + measured + '-d vectors, expected ' + requested + '-d'). Call it right after the pipeline is created on BOTH device paths: the WebGPU success path (before the warmup loop, so a wrong-dim model fails before ~1 s of warmup) AND the WASM paths (proxy worker + SIMD-retry — they have no warmup/probe pass today). Do NOT piggy-back on probeForwardMs (diagnostic; swallows errors) or the warmup loop (skipped on a fingerprint hit). Guards at L1101/L1140 become equality checks against `outputDim` (`!==`, not `<`). sliceAndRenormalize stays but is a pass-through (no MRL slicing in v1). Reminder: the child body is a template literal — no backticks / ${} inside it.
3. One child helper `function embedOpts(maxLength) { return { pooling: pooling, normalize: true, padding: true, truncation: true, max_length: maxLength }; }` (match the exact option sets used today at the six sites; if a site differs, keep the difference explicit via a parameter) — replace all six inline objects.
4. src/embedder.ts: load(spec: ModelLoadSpec, requested) (type from 1/6; dim: number | null) forwards `pooling: spec.pooling, outputDim: spec.dim` — null flows through as "detect" (used only by candidate validation in ticket 5/6; no numeric sentinel). LoadEntry.embeddingDim = result.dim (removes the 1/6 TODO). Parent-side belt-and-braces: if spec.dim !== null && result.dim !== spec.dim → throw (the child already refuses; this keeps the invariant even if the child changes). warmupFingerprint gains pooling (add it to the joined array). Expose `get dim(): number` (measured; 0 before a load) on LocalEmbedder.
5. Tests: src/iframe-runner.test.ts (the 8 `buildChildScript('…', 384)` calls → new one-arg signature; assert the template no longer contains 'OUTPUT_DIM ='; assert the child source contains exactly one `pooling: pooling` occurrence and zero `pooling: 'cls'`; assert `detectOutputDim(` appears in both the webgpu and wasm branches — e.g. count ≥ 3 call sites); src/embedder.test.ts warmupFingerprint pooling case; a test that a load payload includes pooling + outputDim (null passes through untouched, a number passes through untouched); the parent-side dim mismatch throws.

ACCEPTANCE: typecheck + unit tests green; `npm run build` succeeds; run `npm run bench` (docs/perf-bench.md) once as a smoke test that the real iframe still loads and embeds the default model on this machine (the bench is the only real-runtime exercise available outside e2e; it needs a resolvable Chromium + network — if this environment cannot run it, SAY SO in the ticket notes and leave the ticket open with the `need-human` tag instead of closing; do not claim it ran). change_log entry.


## RESOLUTION (2026-09-03)

Implemented as specified; all five change groups landed. Commit `935c42e` (+ the change_log/ticket commit after it).

**What was built**
- `src/iframe-runner.ts`
  - `LoadRequest` gains `pooling: Pooling` and `outputDim: number | null` (null = detect). `LoadResult` gains `dim: number` (measured width).
  - `buildChildScript(cdnUrl)` — one arg; `OUTPUT_DIM` is gone and the module no longer imports `model-registry`.
  - Child keeps `let outputDim = null; let pooling = 'cls';`, RESET from the payload at the top of `loadModel` on every load (recycle-safe).
  - `embedOpts(maxLength, padding)` is the ONE forward-pass option builder. `padding` defaults to `'max_length'` (warmup / probe / profile / detect); the two production embed sites pass the device-dependent value (`wasm → true`). This is the "keep the difference explicit via a parameter" clause of the ticket.
  - `detectOutputDim(requested)`: one forward pass at `(1 × QUERY_SEQ_BUCKETS[0])` (a warmed shape, so no new WebGPU shape), reads `dims[last]`, disposes the tensor, throws `model produced N-d vectors, expected M-d` on mismatch, else adopts the measured width. Called at THREE sites: WebGPU success path (before the warmup loop), the wasm proxy-worker path, and after the plain/SIMD-retry wasm ladder (outside its try/catch, so a dim mismatch is not re-wrapped by `wasmFail` and does not trigger the SIMD retry).
  - Embed guards are `!== outputDim` equality checks; `sliceAndRenormalize` remains a pass-through.
- `src/embedder.ts`
  - `load()` forwards `pooling: spec.pooling, outputDim: spec.dim` (null passes through untouched).
  - Parent-side belt-and-braces: `spec.dim !== null && result.dim !== spec.dim` → throws, `_loaded=false`.
  - `LoadEntry.embeddingDim = result.dim` (1/6 TODO removed). New `get dim(): number` (0 before a load).
  - `warmupFingerprint(modelId, dtype, revision, grid, pooling)` — pooling appended as the 5th arg (only two call sites: `loadImpl` and the test).
- Tests: `src/iframe-runner.test.ts` (new "model identity" describe: no OUTPUT_DIM, exactly one `pooling: pooling`, zero `pooling: 'cls'`, ≥3 `detectOutputDim` calls with the WebGPU one before warmup and one after each wasm site, equality guards, `dim: outputDim` on all 3 returns), `src/embedder.test.ts` (fingerprint pooling case; payload forwards pooling + numeric dim / null dim; detect load reports measured dim on entry + `e.dim`; parent-side mismatch throws and stays unloaded). Existing fake runners now return `dim: ACTIVE_MODEL_SPEC.dim` because the parent check would otherwise reject them.

**Verification**
- `npm run typecheck`: only the 10 pre-existing `e2e/*` errors (missing `@playwright/test` in this container — identical count on the base commit). No `src/` errors.
- `npm run test`: 88 files / 1495 tests pass.
- `npm run build`: ok.
- `npm run bench` (wasm, container Chromium, `BENCH_FORCE=1 BENCH_REPS=1`): REAL iframe loaded the default ml97 model and embedded the 12-file corpus at 3.97 chunks/s (documented baseline ≈ 4), coldStart 1250 ms — detect pass adds nothing measurable. The WebGPU branch of `detectOutputDim` is asserted by source tests only (container has no GPU); `npm run bench:host` on the host is the real-GPU check if wanted.

**Assumptions made (non-interactive)**
- `padding` is an `embedOpts` parameter rather than a fixed `true`, because 4 of the 6 sites use `'max_length'` and the ticket asked to keep differences explicit.
- `warmupFingerprint` pooling is the LAST positional arg (least churn); this invalidates every user's stored fingerprint once (one extra ~1 s warmup) — intended per the plan.

## Notes

**2026-09-03T21:25:01Z**

__READY_AS_IS__: review found one real issue (dim-mismatch error swallowed by the WebGPU/wasm-proxy fallback catches, causing up to 3 reloads of a wrong-width model) — fixed in 7c3ba2a with a source-text test; typecheck, full vitest (1496), build, and the wasm bench smoke (3.99 chunks/s) all pass.
