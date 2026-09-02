import { describe, it, expect } from 'vitest';
import { classifyAdapter, resolveBackendReason, WEBGPU_SLOW_PROBE_MS, REASON_SLOW_WARMUP } from './gpu-adapter';

describe('classifyAdapter', () => {
    it('no adapter → none', () => {
        expect(classifyAdapter({ present: false })).toBe('none');
    });
    it('isFallbackAdapter on the adapter object → software', () => {
        expect(classifyAdapter({ present: true, isFallbackAdapter: true, vendor: 'nvidia' })).toBe('software');
    });
    it('isFallbackAdapter on adapter.info → software', () => {
        expect(classifyAdapter({ present: true, infoIsFallback: true, vendor: 'nvidia' })).toBe('software');
    });
    it("description 'llvmpipe' → software", () => {
        expect(classifyAdapter({ present: true, vendor: 'mesa', description: 'llvmpipe (LLVM 18.1.8, 256 bits)' })).toBe('software');
    });
    it("vendor 'SwiftShader' (case-insensitive) → software", () => {
        expect(classifyAdapter({ present: true, vendor: 'SwiftShader', description: 'x' })).toBe('software');
    });
    it("vendor 'google' with empty description → software (Chromium 151 fallback signature)", () => {
        expect(classifyAdapter({ present: true, vendor: 'google', description: '' })).toBe('software');
    });
    it('real AMD → real', () => {
        expect(classifyAdapter({ present: true, isFallbackAdapter: false, vendor: 'amd', architecture: 'rdna-3.5', description: '' })).toBe('real');
    });
    it('real Apple → real', () => {
        expect(classifyAdapter({ present: true, vendor: 'apple', architecture: 'common-3' })).toBe('real');
    });
    it('real NVIDIA → real', () => {
        expect(classifyAdapter({ present: true, vendor: 'nvidia', architecture: 'ampere', description: 'NVIDIA GeForce RTX 3080' })).toBe('real');
    });
    it('is self-contained enough to be inlined into the iframe template literal (no backticks)', () => {
        expect(classifyAdapter.toString()).not.toContain('`');
    });
});

describe('resolveBackendReason', () => {
    it('WASM after a rejected software adapter carries the webgpu error verbatim', () => {
        expect(resolveBackendReason({ device: 'wasm', webgpuAttempted: true, webgpuError: 'webgpu-fallback-rejected: google/', webgpuProbeMs: null }))
            .toBe('webgpu-fallback-rejected: google/');
    });
    it('WASM that never tried WebGPU has no reason', () => {
        expect(resolveBackendReason({ device: 'wasm', webgpuAttempted: false, webgpuError: null, webgpuProbeMs: null })).toBeNull();
    });
    it('healthy WebGPU has no reason', () => {
        expect(resolveBackendReason({ device: 'webgpu', webgpuAttempted: true, webgpuError: null, webgpuProbeMs: WEBGPU_SLOW_PROBE_MS })).toBeNull();
    });
    it('WebGPU with a slow probe median flags slow-warmup without changing device', () => {
        expect(resolveBackendReason({ device: 'webgpu', webgpuAttempted: true, webgpuError: null, webgpuProbeMs: WEBGPU_SLOW_PROBE_MS + 1 }))
            .toBe(REASON_SLOW_WARMUP);
    });
});
