import { describe, it, expect } from 'vitest';
import {
    shouldWarn, describeBackendLine, detectLinuxPackaging, buildReindexWarningNotice,
    FLATPAK_USER_FLAGS_PATH, WEBGPU_LINUX_FLAGS, README_WEBGPU_LINUX_URL,
} from './backend-warning';
import type { ResolvedBackend } from './platform';

const REJECTED = 'webgpu-fallback-rejected: google/';

function resolved(over: Partial<ResolvedBackend>): ResolvedBackend {
    return { device: 'wasm', requested: 'auto', reason: null, adapter: null, ...over };
}
const realGpu = resolved({
    device: 'webgpu', adapter: { vendor: 'amd', architecture: 'rdna-3.5', description: 'Radeon 8060S' },
});

describe('shouldWarn', () => {
    it('GIVEN desktop auto override resolved to wasm THEN warns', () => {
        expect(shouldWarn('auto', resolved({}), false).warn).toBe(true);
    });
    it('GIVEN desktop webgpu override resolved to wasm THEN warns', () => {
        expect(shouldWarn('webgpu', resolved({}), false).warn).toBe(true);
    });
    it('GIVEN wasm override THEN no warning', () => {
        expect(shouldWarn('wasm', resolved({}), false).warn).toBe(false);
    });
    it('GIVEN mobile THEN no warning', () => {
        expect(shouldWarn('auto', resolved({}), true).warn).toBe(false);
    });
    it('GIVEN real GPU THEN no warning', () => {
        expect(shouldWarn('auto', realGpu, false).warn).toBe(false);
    });
    it('GIVEN webgpu with slow-warmup reason THEN no warning (diagnostic only)', () => {
        expect(shouldWarn('auto', resolved({ device: 'webgpu', reason: 'webgpu-slow-warmup' }), false).warn).toBe(false);
    });
    it('GIVEN no record yet THEN no warning', () => {
        expect(shouldWarn('auto', null, false).warn).toBe(false);
    });
    it('GIVEN software adapter rejected THEN reason names the software adapter and keeps the raw code', () => {
        expect(shouldWarn('auto', resolved({ reason: REJECTED }), false).reason)
            .toBe(`only a software-emulated GPU adapter was found, which is slower than the CPU (${REJECTED})`);
    });
    it('GIVEN wasm with no reason THEN reason says no adapter found', () => {
        expect(shouldWarn('auto', resolved({}), false).reason).toBe('no usable GPU adapter was found');
    });
});

describe('describeBackendLine', () => {
    it('GIVEN no record THEN says not loaded yet', () => {
        expect(describeBackendLine('auto', null, false)).toMatch(/^Running on: not loaded yet/);
    });
    it('GIVEN real GPU THEN calm line with vendor and description', () => {
        expect(describeBackendLine('auto', realGpu, false)).toBe('Running on: WebGPU — amd Radeon 8060S');
    });
    it('GIVEN slow warmup THEN shows the diagnostic reason', () => {
        expect(describeBackendLine('auto', resolved({ device: 'webgpu', reason: 'webgpu-slow-warmup' }), false))
            .toBe('Running on: WebGPU (webgpu-slow-warmup)');
    });
    it('GIVEN wasm override THEN plain CPU line', () => {
        expect(describeBackendLine('wasm', resolved({}), false)).toBe('Running on: CPU (WASM).');
    });
    it('GIVEN desktop auto on wasm THEN warning line', () => {
        expect(describeBackendLine('auto', resolved({}), false))
            .toBe('Running on: CPU (WASM). WebGPU was requested but no usable GPU adapter was found. Indexing will be much slower.');
    });
});

describe('detectLinuxPackaging', () => {
    it('GIVEN not linux THEN null', () => {
        expect(detectLinuxPackaging(false, { FLATPAK_ID: 'md.obsidian.Obsidian' })).toBe(null);
    });
    it('GIVEN FLATPAK_ID THEN flatpak', () => {
        expect(detectLinuxPackaging(true, { FLATPAK_ID: 'md.obsidian.Obsidian' })).toBe('flatpak');
    });
    it('GIVEN container=flatpak THEN flatpak', () => {
        expect(detectLinuxPackaging(true, { container: 'flatpak' })).toBe('flatpak');
    });
    it('GIVEN linux without flatpak markers THEN generic', () => {
        expect(detectLinuxPackaging(true, {})).toBe('generic');
    });
    it('GIVEN linux and no process env THEN generic', () => {
        expect(detectLinuxPackaging(true, undefined)).toBe('generic');
    });
});

describe('buildReindexWarningNotice', () => {
    it('GIVEN flatpak THEN recipe names user-flags.conf', () => {
        expect(buildReindexWarningNotice('x', 'flatpak').lines[1]).toContain(FLATPAK_USER_FLAGS_PATH);
    });
    it('GIVEN generic linux THEN recipe gives the launch flags', () => {
        expect(buildReindexWarningNotice('x', 'generic').lines[1]).toContain(WEBGPU_LINUX_FLAGS);
    });
    it('GIVEN non-linux THEN no user-flags.conf recipe', () => {
        expect(buildReindexWarningNotice('x', null).lines.join('\n')).not.toContain(FLATPAK_USER_FLAGS_PATH);
    });
    it('links to the README section', () => {
        expect(buildReindexWarningNotice('x', 'flatpak').linkUrl).toBe(README_WEBGPU_LINUX_URL);
    });
});
