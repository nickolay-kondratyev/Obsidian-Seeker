---
id: nid_p9ef5qv2rtfqrxa9q91cypec4_e
title: "Unify platform probe gpuIsFallbackAdapter with classifyAdapter (software-adapter rule lives in two places)"
status: open
deps: []
links: [nid_yketo7yrdmkfdhbvywrzgux74_e]
created_iso: 2026-09-02T23:22:57Z
status_updated_iso: 2026-09-02T23:22:57Z
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

