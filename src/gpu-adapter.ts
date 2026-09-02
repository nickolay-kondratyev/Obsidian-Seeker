// WebGPU adapter classification — the gate between "navigator.gpu handed us
// an adapter" and "that adapter is worth running the model on".
//
// WHY: Chromium under --enable-unsafe-webgpu (and some Linux Vulkan setups)
// hands out a SOFTWARE adapter (SwiftShader / lavapipe / llvmpipe) when no
// real GPU is usable. It loads fine, reports device 'webgpu', and is SLOWER
// than the WASM CPU path — so the plugin would silently pick the worst
// backend while the log says WebGPU worked. classifyAdapter is the single
// source of truth for that decision; the iframe child inlines it verbatim
// (see buildChildScript in iframe-runner.ts), so it MUST stay self-contained:
// no imports, no module-scope constants, no backticks (it lands inside a
// template literal).

export type AdapterClass = 'none' | 'software' | 'real';

export interface AdapterProbe {
    present: boolean;
    // GPUAdapter.isFallbackAdapter — older Chromium / spec drafts.
    isFallbackAdapter?: boolean | null;
    // GPUAdapterInfo.isFallbackAdapter — newer Chromium (>= ~M150) moved it here.
    infoIsFallback?: boolean | null;
    vendor?: string;
    architecture?: string;
    description?: string;
}

// The adapter fields that ride the load log entry (WebGPU attempted only).
export interface AdapterSummary {
    vendor: string;
    architecture: string;
    description: string;
    classification: AdapterClass;
}

export function classifyAdapter(input: AdapterProbe): AdapterClass {
    if (!input.present) return 'none';
    if (input.isFallbackAdapter === true || input.infoIsFallback === true) return 'software';
    // Known CPU rasterizers, matched case-insensitively against vendor AND
    // description: SwiftShader (Chromium's bundled fallback), llvmpipe /
    // lavapipe (Mesa's software GL / Vulkan drivers). Some builds only expose
    // them via description, others via vendor, hence checking both.
    const SOFTWARE_ADAPTER_RE = /swiftshader|llvmpipe|lavapipe/i;
    const vendor = input.vendor ?? '';
    const description = input.description ?? '';
    if (SOFTWARE_ADAPTER_RE.test(vendor) || SOFTWARE_ADAPTER_RE.test(description)) return 'software';
    // Observed 2026-09 (container Chromium 151, --enable-unsafe-webgpu): the
    // SwiftShader adapter reports vendor 'google' with an EMPTY description
    // and NO isFallbackAdapter on the adapter object. Google ships no real
    // GPU hardware, so vendor 'google' + nothing else identifying it is the
    // software adapter under a different label.
    if (vendor.toLowerCase() === 'google' && description === '') return 'software';
    return 'real';
}

// Diagnostic heuristic: median wall time of a batch-1 / seq-128 forward pass
// AFTER warmup. A real desktop GPU lands in the low tens of ms; a software or
// otherwise broken adapter (or a Dawn that recompiles every dispatch) sits
// well above this. The reason is logged only — it never changes the device.
// 250 ms is a starting guess; tune against the bench (plan nid_mw6gkmuurjhiqva4rr6doenul_e).
export const WEBGPU_SLOW_PROBE_MS = 250;
export const REASON_SLOW_WARMUP = 'webgpu-slow-warmup';

// Why the load resolved to the backend it did. null = nothing noteworthy
// (WebGPU healthy, or WASM was what we asked for).
export function resolveBackendReason(result: {
    device: 'webgpu' | 'wasm';
    webgpuAttempted: boolean;
    webgpuError: string | null;
    webgpuProbeMs: number | null;
}): string | null {
    if (result.device === 'wasm') return result.webgpuAttempted ? result.webgpuError : null;
    if (result.webgpuProbeMs != null && result.webgpuProbeMs > WEBGPU_SLOW_PROBE_MS) return REASON_SLOW_WARMUP;
    return null;
}
