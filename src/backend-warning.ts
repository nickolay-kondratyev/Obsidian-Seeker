// Backend warning — the pure decision + copy behind "you asked for the GPU but
// you are running on the CPU" (lever #0b, ticket nid_9onhu2309zfy32w37xtmz8a0p_e).
//
// Obsidian-free on purpose: settings-tab.ts renders the permanent line, main.ts
// toasts at every full-reindex start, and both must agree. Policy (human-approved):
//   - never break search — the WASM fallback stays; this only WARNS.
//   - warn only on desktop (phones default to WASM by design) when the user's
//     override is 'auto' or 'webgpu' and the LAST load resolved to WASM.
//   - a device 'webgpu' load is never a warning, even with the diagnostic
//     REASON_SLOW_WARMUP reason (shown in the settings line, not warned on).
//   - no record yet (fresh install, or nothing loaded on this device) → no warning.
//   - the record must come from a load that TRIED the GPU (record.requested is not
//     'wasm'): the override is read live (so Force CPU silences the warning at
//     once), but the loaded model is not swapped on an override change, so a
//     Force CPU record + a switch to Auto must not read as "GPU not found".

import type { BackendChoice, ResolvedBackend } from './platform';

export const README_WEBGPU_LINUX_URL = 'https://github.com/nickolay-kondratyev/Obsidian-Seeker#webgpu-on-linux';

// Prefix of the iframe's webgpuError when a software (SwiftShader / llvmpipe)
// adapter was refused — see iframe-runner.ts / gpu-adapter.ts classifyAdapter.
const REASON_FALLBACK_REJECTED_PREFIX = 'webgpu-fallback-rejected';

export interface BackendWarning {
    warn: boolean;
    // Plain-language cause for the user; null when not warning.
    reason: string | null;
}

export function shouldWarn(override: BackendChoice, resolved: ResolvedBackend | null, isMobile: boolean): BackendWarning {
    if (isMobile || override === 'wasm' || !resolved || resolved.device !== 'wasm' || resolved.requested === 'wasm') {
        return { warn: false, reason: null };
    }
    return { warn: true, reason: describeWasmReason(resolved.reason) };
}

// Why the GPU was not used, in user vocabulary, with the raw reason kept in
// parentheses for bug reports. `raw` is the iframe's webgpuError (or null when
// WebGPU was never attempted — e.g. navigator.gpu absent).
function describeWasmReason(raw: string | null): string {
    if (raw == null) return 'no usable GPU adapter was found';
    if (raw.startsWith(REASON_FALLBACK_REJECTED_PREFIX)) {
        return `only a software-emulated GPU adapter was found, which is slower than the CPU (${raw})`;
    }
    return `the GPU failed to initialise (${raw})`;
}

// The permanent status line at the top of the settings tab.
export function describeBackendLine(override: BackendChoice, resolved: ResolvedBackend | null, isMobile: boolean): string {
    if (!resolved) return 'Running on: not loaded yet (the compute backend is known after the first search or index).';
    if (resolved.device === 'webgpu') {
        const a = resolved.adapter;
        const gpu = a && (a.vendor || a.description) ? ` — ${[a.vendor, a.description].filter(Boolean).join(' ')}` : '';
        const slow = resolved.reason ? ` (${resolved.reason})` : '';
        return `Running on: WebGPU${gpu}${slow}`;
    }
    const w = shouldWarn(override, resolved, isMobile);
    if (!w.warn) {
        const gpuPending = !isMobile && override !== 'wasm' && resolved.requested === 'wasm';
        return gpuPending ? 'Running on: CPU (WASM). WebGPU will be tried at the next model load.' : 'Running on: CPU (WASM).';
    }
    return `Running on: CPU (WASM). WebGPU was requested but ${w.reason}. Indexing will be much slower.`;
}

// Which Linux troubleshooting recipe to show. 'flatpak' when Obsidian runs inside
// a Flatpak sandbox (flags persist in user-flags.conf), 'generic' for AppImage /
// rpm / tarball (flags go on the command line), null off Linux.
export type LinuxPackaging = 'flatpak' | 'generic' | null;

export function detectLinuxPackaging(isLinux: boolean, env: Record<string, string | undefined> | undefined): LinuxPackaging {
    if (!isLinux) return null;
    if (env && (env.FLATPAK_ID || env.container === 'flatpak')) return 'flatpak';
    return 'generic';
}

// Node's `process.env` as seen from the Obsidian desktop renderer (Electron exposes
// Node there). Guarded: absent on mobile and in the vitest DOM, never throws.
export function readProcessEnv(): Record<string, string | undefined> | undefined {
    try {
        const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
        return p && typeof p.env === 'object' ? p.env : undefined;
    } catch { return undefined; }
}

export const WEBGPU_LINUX_FLAGS = '--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist';
export const FLATPAK_USER_FLAGS_PATH = '~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf';

export interface ReindexWarningNotice {
    // Paragraphs, in order; the renderer appends the README link after them.
    lines: string[];
    linkLabel: string;
    linkUrl: string;
}

// Pop-up text for the reindex-start warning. Plain language: what is wrong, how to
// fix it. Linux gets the verified recipe (Flatpak-aware); other desktops the short form.
export function buildReindexWarningNotice(reason: string, linux: LinuxPackaging): ReindexWarningNotice {
    const lines = [`Seeker is indexing on the CPU: WebGPU was requested but ${reason}. Indexing will be much slower.`];
    if (linux === 'flatpak') {
        lines.push(`To enable the GPU, add each of these flags on its own line to ${FLATPAK_USER_FLAGS_PATH} and restart Obsidian: ${WEBGPU_LINUX_FLAGS}`);
    } else if (linux === 'generic') {
        lines.push(`To enable the GPU, launch Obsidian with these flags (or add them to the Exec= line of its .desktop file): ${WEBGPU_LINUX_FLAGS}`);
    } else {
        lines.push('Search still works. To use the GPU, make sure hardware acceleration is enabled in Obsidian and your graphics drivers are current, or pick "Force CPU" in Seeker settings to silence this warning.');
    }
    return { lines, linkLabel: 'Troubleshooting: WebGPU on Linux (README)', linkUrl: README_WEBGPU_LINUX_URL };
}
