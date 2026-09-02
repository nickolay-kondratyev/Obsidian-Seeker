// Per-device compute-backend resolution: the capability allowlist, the manual
// override precedence, and the crash-demote tripwire. These decide WebGPU vs
// WASM per physical device, so the Android-tablet-stays-WASM and
// demote-only-on-WebGPU assertions are the load-bearing ones.

import { describe, it, expect, beforeEach, vi } from 'vitest';
// Aliased to src/test-stubs/obsidian.ts via vitest.config.mts — the SAME object
// platform.ts imports, so mutating it here poses as a device class at call time.
import { Platform } from 'obsidian';

import {
    resolveDevice,
    getBackendOverride,
    setBackendOverride,
    isWebgpuDemoted,
    clearWebgpuDemoted,
    recordActiveBackend,
    recordResolvedBackend,
    getResolvedBackend,
    type ResolvedBackend,
    maybeDemoteOnCrash,
    residentInt8Enabled,
    RESIDENT_INT8_MAX_BYTES,
    collectPlatformInfo,
} from './platform';

// Minimal in-memory localStorage (node has no DOM). Reset per test.
function installLocalStorage(): void {
    let store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
    });
}

// Pose as a device class.
function setDevice(kind: 'desktop' | 'ipad' | 'iphone' | 'android-phone' | 'android-tablet'): void {
    Platform.isMobile = kind !== 'desktop';
    Platform.isIosApp = kind === 'ipad' || kind === 'iphone';
    Platform.isTablet = kind === 'ipad' || kind === 'android-tablet';
}

beforeEach(() => {
    installLocalStorage();
    setDevice('desktop');
});

describe('capability allowlist (no override, no demote)', () => {
    it('desktop → auto (WebGPU)', () => {
        setDevice('desktop');
        expect(resolveDevice()).toBe('auto');
    });

    it('iPad → auto (WebGPU)', () => {
        setDevice('ipad');
        expect(resolveDevice()).toBe('auto');
    });

    it('iPhone → wasm', () => {
        setDevice('iphone');
        expect(resolveDevice()).toBe('wasm');
    });

    it('Android phone → wasm', () => {
        setDevice('android-phone');
        expect(resolveDevice()).toBe('wasm');
    });

    it('Android tablet → wasm (allowlist, NOT mobile-minus-iPhone)', () => {
        // The whole point of an allowlist: an untested tablet stays safe.
        setDevice('android-tablet');
        expect(resolveDevice()).toBe('wasm');
    });
});

describe('manual override precedence', () => {
    it('force wasm overrides an allowlisted iPad', () => {
        setDevice('ipad');
        setBackendOverride('wasm');
        expect(resolveDevice()).toBe('wasm');
    });

    it('force webgpu maps to auto even on iPhone', () => {
        setDevice('iphone');
        setBackendOverride('webgpu');
        expect(resolveDevice()).toBe('auto');
    });

    it('explicit auto falls back to the allowlist', () => {
        setDevice('android-tablet');
        setBackendOverride('auto');
        expect(resolveDevice()).toBe('wasm');
    });

    it('override round-trips through localStorage', () => {
        setBackendOverride('wasm');
        expect(getBackendOverride()).toBe('wasm');
    });

    it('absent override reads as auto', () => {
        expect(getBackendOverride()).toBe('auto');
    });
});

describe('demote tripwire', () => {
    it('a demoted iPad resolves to wasm on the auto path', () => {
        setDevice('ipad');
        recordActiveBackend('webgpu');
        expect(maybeDemoteOnCrash('crash-while-indexing-foreground')).toBe(true);
        expect(isWebgpuDemoted()).toBe(true);
        expect(resolveDevice()).toBe('wasm');
    });

    it('does NOT demote desktop (auto path ignores the mobile-only flag)', () => {
        // Trip the flag while mobile, then resolve as desktop: demote is gated
        // on Platform.isMobile, so a desktop never self-disables.
        setDevice('ipad');
        recordActiveBackend('webgpu');
        maybeDemoteOnCrash('crash-while-indexing-foreground');
        setDevice('desktop');
        expect(resolveDevice()).toBe('auto');
    });

    it('forcing WebGPU clears a sticky demote', () => {
        setDevice('ipad');
        recordActiveBackend('webgpu');
        maybeDemoteOnCrash('crash-while-indexing-foreground');
        expect(isWebgpuDemoted()).toBe(true);
        setBackendOverride('webgpu');
        expect(isWebgpuDemoted()).toBe(false);
    });

    it('clearWebgpuDemoted re-enables the auto WebGPU path', () => {
        setDevice('ipad');
        recordActiveBackend('webgpu');
        maybeDemoteOnCrash('crash-while-indexing-foreground');
        clearWebgpuDemoted();
        expect(resolveDevice()).toBe('auto');
    });
});

describe('demote gating — never blame WASM or a non-indexing crash', () => {
    it('a WASM-reindex foreground kill does NOT demote WebGPU', () => {
        setDevice('iphone');
        recordActiveBackend('wasm');
        expect(maybeDemoteOnCrash('crash-while-indexing-foreground')).toBe(false);
        expect(isWebgpuDemoted()).toBe(false);
    });

    it('a hidden (background) indexing kill does NOT demote', () => {
        setDevice('ipad');
        recordActiveBackend('webgpu');
        expect(maybeDemoteOnCrash('crash-while-indexing-hidden')).toBe(false);
        expect(isWebgpuDemoted()).toBe(false);
    });

    it('a non-indexing crash verdict does NOT demote', () => {
        setDevice('ipad');
        recordActiveBackend('webgpu');
        expect(maybeDemoteOnCrash('evicted-while-hidden')).toBe(false);
        expect(isWebgpuDemoted()).toBe(false);
    });

    it('desktop is never demoted even with WebGPU active', () => {
        setDevice('desktop');
        recordActiveBackend('webgpu');
        expect(maybeDemoteOnCrash('crash-while-indexing-foreground')).toBe(false);
    });
});

// residentInt8Enabled keys off isMobilePlatform(), which now reads
// Platform.isMobile — so these pose as a device with setDevice(), exactly like
// the resolveDevice tests above.
describe('residentInt8Enabled — B2 resident-block memory gate', () => {
    it('mobile → always disabled, regardless of size', () => {
        setDevice('iphone');
        expect(residentInt8Enabled(10, 384)).toBe(false);
        expect(residentInt8Enabled(1, 8)).toBe(false);
    });

    it('desktop well under the byte budget → enabled', () => {
        setDevice('desktop');
        expect(residentInt8Enabled(1000, 384)).toBe(true); // 1000*392 ≈ 392 KB
    });

    it('desktop over the byte budget → disabled', () => {
        setDevice('desktop');
        const overBudget = Math.ceil(RESIDENT_INT8_MAX_BYTES / (384 + 8)) + 1;
        expect(residentInt8Enabled(overBudget, 384)).toBe(false);
    });

    it('budget tracks embDim: same row count flips with a larger model dim', () => {
        setDevice('desktop');
        const rows = 40000;
        expect(residentInt8Enabled(rows, 384)).toBe(true);  // 40000*392 = 15.68 MB ≤ 16 MB
        expect(residentInt8Enabled(rows, 512)).toBe(false); // 40000*520 = 20.8 MB > 16 MB
    });

    it('budget boundary is inclusive (≤, not <)', () => {
        setDevice('desktop');
        const embDim = 8;
        const rows = RESIDENT_INT8_MAX_BYTES / (embDim + 8); // 16 MB / 16 = 1048576, exact
        expect(Number.isInteger(rows)).toBe(true);
        expect(residentInt8Enabled(rows, embDim)).toBe(true);
        expect(residentInt8Enabled(rows + 1, embDim)).toBe(false);
    });
});

describe('resolved backend record (lever 0a)', () => {
    const sample: ResolvedBackend = {
        device: 'wasm',
        requested: 'webgpu',
        reason: 'webgpu-fallback-rejected: google/',
        adapter: { vendor: 'google', architecture: '', description: '' },
    };
    it('is null before any load', () => {
        expect(getResolvedBackend()).toBeNull();
    });
    it('round-trips the full record', () => {
        recordResolvedBackend(sample);
        expect(getResolvedBackend()).toEqual(sample);
    });
    it('also stamps the legacy active-backend key the demote tripwire reads', () => {
        setDevice('iphone');
        recordResolvedBackend({ ...sample, device: 'webgpu' });
        expect(maybeDemoteOnCrash('crash-while-indexing-foreground')).toBe(true);
    });
    it('returns null on a corrupt record instead of throwing', () => {
        localStorage.setItem('seek-resolved-backend', '{not json');
        expect(getResolvedBackend()).toBeNull();
    });
});

// The platform probe MUST classify the adapter with the same rule the load
// path uses (gpu-adapter.ts classifyAdapter) — the reference container's
// report once said "GPU yes / not fallback" while the load entry said
// 'software' and fell back to WASM. One rule, one answer.
describe('collectPlatformInfo — WebGPU adapter classification', () => {
    interface FakeAdapter {
        isFallbackAdapter?: boolean;
        info?: { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean };
        requestAdapterInfo?: () => Promise<{ vendor?: string; description?: string }>;
    }
    function installNavigator(adapter: FakeAdapter | null | 'no-webgpu'): void {
        vi.stubGlobal('navigator', {
            userAgent: 'test-ua',
            ...(adapter === 'no-webgpu' ? {} : { gpu: { requestAdapter: async () => adapter } }),
        });
        vi.stubGlobal('performance', {});
    }

    it("no navigator.gpu → gpuAvailable false, class 'none'", async () => {
        installNavigator('no-webgpu');
        const entry = await collectPlatformInfo();
        expect([entry.gpuAvailable, entry.gpuAdapterClass]).toEqual([false, 'none']);
    });
    it("requestAdapter → null → class 'none'", async () => {
        installNavigator(null);
        expect((await collectPlatformInfo()).gpuAdapterClass).toBe('none');
    });
    it("Chromium 151 SwiftShader signature (vendor 'google', empty description, no flag) → 'software'", async () => {
        installNavigator({ info: { vendor: 'google', architecture: '', description: '' } });
        const entry = await collectPlatformInfo();
        expect([entry.gpuAvailable, entry.gpuAdapterClass]).toEqual([true, 'software']);
    });
    it("isFallbackAdapter on adapter.info → 'software'", async () => {
        installNavigator({ info: { vendor: 'nvidia', description: 'x', isFallbackAdapter: true } });
        expect((await collectPlatformInfo()).gpuAdapterClass).toBe('software');
    });
    it("legacy requestAdapterInfo() path: description 'llvmpipe' → 'software' with description recorded", async () => {
        installNavigator({ requestAdapterInfo: async () => ({ vendor: 'mesa', description: 'llvmpipe (LLVM 18)' }) });
        const entry = await collectPlatformInfo();
        expect([entry.gpuAdapterClass, entry.gpuAdapterDescription]).toEqual(['software', 'llvmpipe (LLVM 18)']);
    });
    it("real GPU → 'real'", async () => {
        installNavigator({ isFallbackAdapter: false, info: { vendor: 'apple', architecture: 'common-3', description: '' } });
        expect((await collectPlatformInfo()).gpuAdapterClass).toBe('real');
    });
    it("adapter.info throwing is cosmetic → still 'real' (flags-only, no identity)", async () => {
        const adapter: FakeAdapter = { isFallbackAdapter: false };
        Object.defineProperty(adapter, 'info', { get() { throw new Error('not exposed'); } });
        installNavigator(adapter);
        const entry = await collectPlatformInfo();
        expect([entry.gpuAvailable, entry.gpuAdapterClass, entry.gpuAdapterDescription]).toEqual([true, 'real', null]);
    });
});
