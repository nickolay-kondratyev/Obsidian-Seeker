import { describe, it, expect } from 'vitest';
import { SweepVerdict, SweepReport, LEVER_MIN_GAIN_PCT } from './bench-sweep-report.mjs';

function row(spec, { wall, wallSpread = 3, embed = wall * 0.6, recycles = 0, failed = null, gridPasses = 100 } = {}) {
    const [budgetTokens, maxBatch] = spec.split('/').map(Number);
    return {
        sizing: { budgetTokens, maxBatch }, gridPasses,
        wallClockMs: { median: wall, spreadPct: wallSpread },
        embedDurationMs: { median: embed, spreadPct: wallSpread },
        embedDispatches: 100, effectiveBatch: 4, p95BatchMs: 30, warmupColdMs: 5000,
        embedRecycles: recycles, failed,
    };
}
const reference = row('512/8', { wall: 10000 });

describe('SweepVerdict.failReasons', () => {
    it('GIVEN 15 % gain, low spread, no recycles THEN passes', () => {
        expect(SweepVerdict.failReasons(reference, row('2048/16', { wall: 8500 }))).toEqual([]);
    });
    it('GIVEN gain just under the threshold THEN fails on gain', () => {
        const reasons = SweepVerdict.failReasons(reference, row('2048/16', { wall: 10000 * (1 - (LEVER_MIN_GAIN_PCT - 0.1) / 100) }));
        expect(reasons).toEqual([expect.stringMatching(/gain .* < 10 %/)]);
    });
    it('GIVEN candidate spread at 10 % THEN fails on spread', () => {
        expect(SweepVerdict.failReasons(reference, row('2048/16', { wall: 8000, wallSpread: 10 }))).toEqual([expect.stringMatching(/spread 10\.0 %/)]);
    });
    it('GIVEN any embed recycle THEN fails regardless of gain', () => {
        expect(SweepVerdict.failReasons(reference, row('4096/32', { wall: 5000, recycles: 1 }))).toEqual([expect.stringMatching(/embedRecycles=1/)]);
    });
    it('GIVEN a failed run THEN the only reason is the failure', () => {
        expect(SweepVerdict.failReasons(reference, row('4096/32', { wall: 0, failed: 'harness exited' }))).toEqual(['run failed: harness exited']);
    });
});

describe('SweepVerdict.evaluate — the pick', () => {
    it('GIVEN one passing candidate THEN option A with that sizing', () => {
        const { pick } = SweepVerdict.evaluate(reference, [row('1024/16', { wall: 9500 }), row('2048/16', { wall: 8000 })]);
        expect(pick).toMatchObject({ option: 'A', sizing: { budgetTokens: 2048, maxBatch: 16 } });
    });
    it('GIVEN two candidates within the same whole-percent gain THEN the smaller budget wins', () => {
        const { pick } = SweepVerdict.evaluate(reference, [row('4096/16', { wall: 8010, embed: 4000 }), row('2048/16', { wall: 8040, embed: 4000 })]);
        expect(pick.sizing).toEqual({ budgetTokens: 2048, maxBatch: 16 });
    });
    it('GIVEN equal wall-clock gain THEN the better embed gain wins before the budget tie-break', () => {
        const { pick } = SweepVerdict.evaluate(reference, [row('2048/16', { wall: 8000, embed: 5000 }), row('4096/16', { wall: 8000, embed: 4000 })]);
        expect(pick.sizing).toEqual({ budgetTokens: 4096, maxBatch: 16 });
    });
    it('GIVEN no candidate clears the rule THEN option B keeps the reference sizing', () => {
        const { pick } = SweepVerdict.evaluate(reference, [row('2048/16', { wall: 9500 })]);
        expect(pick).toMatchObject({ option: 'B', sizing: { budgetTokens: 512, maxBatch: 8 } });
    });
    it('GIVEN a noisy reference THEN RERUN even when a candidate looks great', () => {
        const noisy = row('512/8', { wall: 10000, wallSpread: 12 });
        expect(SweepVerdict.evaluate(noisy, [row('2048/16', { wall: 5000 })]).pick.option).toBe('RERUN');
    });
    it('GIVEN a failed reference THEN RERUN with the failure as reason', () => {
        const dead = row('512/8', { wall: 0, failed: 'no GPU' });
        expect(SweepVerdict.evaluate(dead, [row('2048/16', { wall: 5000 })]).pick).toMatchObject({ option: 'RERUN', reason: expect.stringContaining('no GPU') });
    });
    it('decorates every row with gain and verdict', () => {
        const { rows } = SweepVerdict.evaluate(reference, [row('2048/16', { wall: 8000 })]);
        expect(rows[0]).toMatchObject({ gainPct: 20, passes: true, reasons: [] });
    });
});

describe('SweepReport.render', () => {
    const context = { date: '2026-09-03', machine: { cpu: 'Ryzen', cores: 32, platform: 'linux', arch: 'x64' }, git: { commit: 'abc1234', dirty: false }, device: 'webgpu', files: 70, reps: 3, adapter: { vendor: 'amd', architecture: 'rdna-3', classification: 'real' } };
    const verdict = SweepVerdict.evaluate(reference, [row('2048/16', { wall: 8000 }), row('4096/32', { wall: 0, failed: 'harness exited' })]);
    const md = SweepReport.render({ context, reference, verdict });

    it('names the constant to set in the verdict line', () => {
        expect(md).toContain('DESKTOP_WEBGPU_BATCH_SIZING = { budgetTokens: 2048, maxBatch: 16 }');
    });
    it('marks the reference row', () => {
        expect(md).toContain('| 512/8 (reference) | 100 | 10000 |');
    });
    it('shows the gain and PASS on a winning row', () => {
        expect(md).toMatch(/\| 2048\/16 \|.*\| −20\.0 % \| PASS \|/);
    });
    it('keeps a failed candidate in the table with its error', () => {
        expect(md).toMatch(/\| 4096\/32 \|.*\| FAIL \| FAILED: harness exited \|/);
    });
    it('renders a skipped warmup instead of a number', () => {
        const skipped = { ...row('1024/16', { wall: 9000 }), warmupColdMs: null };
        expect(SweepReport.tableRow(skipped)).toContain('skipped (fingerprint hit)');
    });
});
