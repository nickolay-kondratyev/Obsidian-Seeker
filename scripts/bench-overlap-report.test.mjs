import { describe, it, expect } from 'vitest';
import { OverlapVerdict, OverlapReport } from './bench-overlap-report.mjs';

function row(depth, { wall, wallSpread = 3, embed = wall * 0.6, inFlight = depth, recycles = 0, failed = null } = {}) {
    return {
        depth,
        wallClockMs: { median: wall, spreadPct: wallSpread },
        embedDurationMs: { median: embed, spreadPct: wallSpread },
        embedDispatches: 40, effectiveBatch: 9.8, p95BatchMs: 56, embedMaxInFlight: inFlight,
        embedRecycles: recycles, failed,
    };
}
const reference = row(1, { wall: 2880 });

describe('OverlapVerdict.evaluate', () => {
    it('GIVEN ≥ 10 % gain, low spread, overlap observed THEN KEEP', () => {
        expect(OverlapVerdict.evaluate(reference, row(2, { wall: 2500 })).option).toBe('KEEP');
    });
    it('GIVEN a gain under 10 % THEN REVERT on gain', () => {
        const v = OverlapVerdict.evaluate(reference, row(2, { wall: 2700 }));
        expect({ option: v.option, reasons: v.reasons }).toEqual({ option: 'REVERT', reasons: [expect.stringMatching(/gain .* < 10 %/)] });
    });
    it('GIVEN a big gain but the dispatches never overlapped THEN REVERT (not a measurement)', () => {
        const v = OverlapVerdict.evaluate(reference, row(2, { wall: 2000, inFlight: 1 }));
        expect(v.reasons).toEqual([expect.stringMatching(/embedMaxInFlight=1 ≠ depth 2/)]);
    });
    it('GIVEN a recycle in the candidate THEN REVERT regardless of gain', () => {
        expect(OverlapVerdict.evaluate(reference, row(2, { wall: 2000, recycles: 1 })).option).toBe('REVERT');
    });
    it('GIVEN a noisy reference THEN RERUN', () => {
        expect(OverlapVerdict.evaluate(row(1, { wall: 2880, wallSpread: 12 }), row(2, { wall: 2000 })).option).toBe('RERUN');
    });
    it('GIVEN a reference that itself overlapped THEN RERUN', () => {
        expect(OverlapVerdict.evaluate(row(1, { wall: 2880, inFlight: 2 }), row(2, { wall: 2000 })).option).toBe('RERUN');
    });
    it('GIVEN a failed candidate run THEN REVERT with the failure as the reason', () => {
        const v = OverlapVerdict.evaluate(reference, row(2, { wall: 0, failed: 'no GPU' }));
        expect({ option: v.option, gainPct: v.gainPct, reasons: v.reasons }).toEqual({ option: 'REVERT', gainPct: null, reasons: ['run failed: no GPU'] });
    });
    it('reports the wall-clock gain in percent', () => {
        expect(OverlapVerdict.evaluate(reference, row(2, { wall: 2592 })).gainPct).toBeCloseTo(10, 5);
    });
});

describe('OverlapReport.render', () => {
    const context = { date: '2026-09-03T00:00:00Z', machine: { cpu: 'cpu', cores: 32, platform: 'linux', arch: 'x64' }, git: { commit: 'abc1234', dirty: false }, device: 'webgpu', pacing: 'unfocused', files: 70, reps: 3, adapter: { vendor: 'amd', architecture: 'rdna-3', classification: 'real' } };
    it('renders one row per depth plus a KEEP verdict line', () => {
        const candidate = row(2, { wall: 2500 });
        const md = OverlapReport.render({ context, reference, candidate, verdict: OverlapVerdict.evaluate(reference, candidate) });
        expect(md).toContain('| depth 1 | 2880 |');
        expect(md).toContain('| depth 2 | 2500 |');
        expect(md).toContain('**VERDICT: KEEP');
    });
    it('a REVERT verdict names the constant to set back', () => {
        const candidate = row(2, { wall: 2800 });
        const md = OverlapReport.render({ context, reference, candidate, verdict: OverlapVerdict.evaluate(reference, candidate) });
        expect(md).toContain('DESKTOP_WEBGPU_DISPATCH_DEPTH = 1');
    });
});
