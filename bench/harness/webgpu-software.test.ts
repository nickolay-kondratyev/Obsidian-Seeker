// Executable check of lever #0a (gpu-adapter.ts classifyAdapter + the iframe
// rejection) against the REAL Chromium adapter shapes, not a mocked probe.
// Ticket nid_ao3yiodwpuanpxzcuyppja2w0_e (plan nid_mw6gkmuurjhiqva4rr6doenul_e).
//
// Each describe spawns bench/harness/run.mjs once in BENCH_PROBE=1 mode
// (model load only, ~5 s warm) and parses the single JSON object it prints;
// the `it`s assert one field each. Gated on BENCH=1 like the other bench
// tests (src/binary.test.ts) so plain `npm run test` never launches Chromium.
//
//   BENCH=1 npx vitest run bench/harness/webgpu-software.test.ts
//
// Observed 2026-09 in the dev container (Chromium 151, no /dev/dri):
//   webgpu-software (--enable-unsafe-webgpu) → SwiftShader adapter, vendor
//     'google', architecture 'swiftshader', EMPTY description → rejected.
//   webgpu-absent (no GPU flags) → navigator.gpu exists but requestAdapter
//     returns null. Other headless builds omit navigator.gpu entirely; both
//     are accepted because either is "no adapter", never a software rejection.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = 'bench/harness/run.mjs';
// Cold first run downloads the ~100 MB model into .bench-cache; warm runs are seconds.
const PROBE_TIMEOUT_MS = 10 * 60 * 1000;
const REASON_FALLBACK_REJECTED_PREFIX = 'webgpu-fallback-rejected';
const NO_ADAPTER_ERRORS = ['requestAdapter returned null', 'navigator.gpu not present'];

// The subset of the harness probe JSON (run.mjs summarizeLoad) these tests read.
interface ProbeOutput {
    actualDevice: string;
    resolvedReason: string | null;
    webgpuError: string | null;
    adapter: { vendor: string; classification: string } | null;
}

interface Probe {
    parsed: ProbeOutput;
    // Raw stdout, attached to every assertion so a shape change is diagnosable.
    raw: string;
}

function runProbe(benchDevice: string): Probe {
    const res = spawnSync('node', [HARNESS], {
        cwd: REPO_ROOT,
        env: { ...process.env, BENCH_PROBE: '1', BENCH_DEVICE: benchDevice },
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
    });
    if (res.status !== 0) {
        throw new Error(`harness exited ${res.status} for BENCH_DEVICE=${benchDevice}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    }
    return { parsed: JSON.parse(res.stdout) as ProbeOutput, raw: res.stdout };
}

describe.skipIf(!process.env.BENCH)('BENCH_DEVICE=webgpu-software: SwiftShader adapter is rejected', () => {
    let probe: Probe;
    beforeAll(() => { probe = runProbe('webgpu-software'); }, PROBE_TIMEOUT_MS);

    it('lands on wasm', () => {
        expect(probe.parsed.actualDevice, probe.raw).toBe('wasm');
    });

    it('reason is the software-adapter rejection', () => {
        expect(probe.parsed.resolvedReason ?? '', probe.raw).toMatch(new RegExp('^' + REASON_FALLBACK_REJECTED_PREFIX));
    });

    it('adapter summary reports vendor google', () => {
        expect(probe.parsed.adapter?.vendor, probe.raw).toBe('google');
    });
});

describe.skipIf(!process.env.BENCH)('BENCH_DEVICE=webgpu-absent: no adapter at all', () => {
    let probe: Probe;
    beforeAll(() => { probe = runProbe('webgpu-absent'); }, PROBE_TIMEOUT_MS);

    it('lands on wasm', () => {
        expect(probe.parsed.actualDevice, probe.raw).toBe('wasm');
    });

    it('webgpuError says no adapter, not a software rejection', () => {
        expect(NO_ADAPTER_ERRORS, probe.raw).toContain(probe.parsed.webgpuError);
    });
});
