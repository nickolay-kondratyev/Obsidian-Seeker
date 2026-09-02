---
closed_iso: 2026-09-02T23:31:15Z
session_ids: [{"a": "claude", "type": "execution", "id": "6b246054-83c7-4120-9fd6-95e64a422cfb"}, {"a": "claude", "type": "review", "id": "d2076931-e4a2-409b-8acc-ad982897ebfe"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_p9ef5qv2rtfqrxa9q91cypec4_e
title: "Unify platform probe gpuIsFallbackAdapter with classifyAdapter (software-adapter rule lives in two places)"
status: closed
deps: []
links: [nid_yketo7yrdmkfdhbvywrzgux74_e]
created_iso: 2026-09-02T23:22:57Z
status_updated_iso: 2026-09-02T23:31:15Z
type: chore
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [perf, webgpu, diagnostics, dry]
---

Follow-up from review of nid_yketo7yrdmkfdhbvywrzgux74_e (lever 0a).

Problem: the software-adapter rule now exists in two places that can disagree in one diagnostic report.
- src/gpu-adapter.ts classifyAdapter(): flags (adapter.isFallbackAdapter / info.isFallbackAdapter) + vendor/description regex (swiftshader|llvmpipe|lavapipe) + the Chromium 151 signature (vendor 'google' with empty description). Used by the iframe child (src/iframe-runner.ts summarizeAdapter) to REJECT software adapters and by the LoadEntry.adapter log field.
- src/platform.ts collectPlatformInfo() (~lines 219-260) still derives PlatformEntry.gpuIsFallbackAdapter from the boolean flags ONLY, and src/logger.ts (~line 738) renders "SOFTWARE FALLBACK" from that field.

On the reference container (Chromium 151, --enable-unsafe-webgpu, adapter vendor 'google', description '', no flag) the platform section of the report says GPU available / not fallback while the load entry says adapter classification 'software' and the load fell back to WASM with reason 'webgpu-fallback-rejected'. Two answers to "is this GPU real" in one report.

Fix: have collectPlatformInfo() build the same AdapterProbe input and call classifyAdapter(); either replace gpuIsFallbackAdapter with a gpuAdapterClass field (bump LOG_SCHEMA_VERSION in src/types.ts, update the src/logger.ts renderer) or keep the boolean and set it from classification === 'software'. Keep src/platform.test.ts green; add one test per classification for the platform probe.

## Acceptance Criteria

The platform report and the load entry agree on software-vs-real for the same adapter; one rule (classifyAdapter) feeds both; npm run test and npm run typecheck green.


## Resolution (2026-09-02)

Chose the "replace the boolean" option: `PlatformEntry.gpuIsFallbackAdapter: boolean | null` is gone,
replaced by `PlatformEntry.gpuAdapterClass: AdapterClass` (`'none' | 'software' | 'real'`). The old
`null` ("attribute not exposed") had no meaning once classifyAdapter always yields a verdict, and the
tri-state matches the load entry's `adapter.classification` field-for-field.

- `src/platform.ts` collectPlatformInfo(): reads adapter identity once (`adapter.info`, falling back
  to legacy `requestAdapterInfo()`), builds an `AdapterProbe` (both isFallbackAdapter locations +
  vendor/architecture/description) and calls `classifyAdapter()`. No rule logic lives here anymore.
- `src/types.ts`: `LOG_SCHEMA_VERSION` 17 -> 18 (breaking rename; pre-v18 rows lack the field).
- `src/logger.ts`: "⚠️ SOFTWARE FALLBACK" renders from `gpuAdapterClass === 'software'`.
- `src/platform.test.ts`: new `collectPlatformInfo` suite — no WebGPU, null adapter, Chromium 151
  google/'' signature, info.isFallbackAdapter, legacy requestAdapterInfo llvmpipe, real Apple, and
  adapter.info throwing (cosmetic, still classifies from flags). Stubs `navigator` via vi.stubGlobal;
  works because test-setup aliases `window` to globalThis.

Verified: `npm run test` (67 files, 1220 passed), `npm run typecheck`, `npm run build` all green.
