// Pure half of the batch-sizing sweep (scripts/bench-sweep.mjs): the 10 %-median
// acceptance rule from docs/perf-bench.md applied across candidates, and the
// markdown report the human pastes into the ticket. No I/O here so it is unit
// tested (bench-sweep-report.test.mjs).
import { BatchSizingSpec } from '../bench/harness/batch-sizing-spec.mjs';

// docs/perf-bench.md, "Accepting a lever: the 10 %-median rule".
export const LEVER_MIN_GAIN_PCT = 10;
export const LEVER_MAX_SPREAD_PCT = 10;

/**
 * One sweep row, as built by bench-sweep.mjs from a bench session:
 * { sizing:{budgetTokens,maxBatch}, gridPasses, wallClockMs:{median,spreadPct},
 *   embedDurationMs:{median,spreadPct}, embedDispatches, effectiveBatch, p95BatchMs,
 *   warmupColdMs (null when the fingerprint hit and warmup was skipped),
 *   embedRecycles, failed (error text or null) }
 */
export class SweepVerdict {
    static gainPct(reference, candidate) {
        return ((reference - candidate) / reference) * 100;
    }

    /** Why a candidate is out, or [] when it passes the rule against `reference`. */
    static failReasons(reference, row) {
        if (row.failed) return [`run failed: ${row.failed}`];
        const reasons = [];
        if (row.embedRecycles > 0) reasons.push(`embedRecycles=${row.embedRecycles} (ORT-Web overflow path hit)`);
        if (row.wallClockMs.spreadPct >= LEVER_MAX_SPREAD_PCT) reasons.push(`spread ${row.wallClockMs.spreadPct.toFixed(1)} % ≥ ${LEVER_MAX_SPREAD_PCT} %`);
        const gain = SweepVerdict.gainPct(reference.wallClockMs.median, row.wallClockMs.median);
        if (gain < LEVER_MIN_GAIN_PCT) reasons.push(`wall-clock gain ${gain.toFixed(1)} % < ${LEVER_MIN_GAIN_PCT} %`);
        return reasons;
    }

    /**
     * Decorates every candidate with gains + verdict and picks the winner.
     * Options are the ticket's: A = a candidate clears the rule, B = none does
     * (keep the base sizing), RERUN = the reference itself is too noisy.
     */
    static evaluate(reference, candidates) {
        if (reference.failed) return { rows: [], pick: { option: 'RERUN', sizing: null, reason: `reference run failed: ${reference.failed}` } };
        const rows = candidates.map(row => {
            const reasons = SweepVerdict.failReasons(reference, row);
            return {
                ...row,
                gainPct: row.failed ? null : SweepVerdict.gainPct(reference.wallClockMs.median, row.wallClockMs.median),
                embedGainPct: row.failed ? null : SweepVerdict.gainPct(reference.embedDurationMs.median, row.embedDurationMs.median),
                passes: reasons.length === 0,
                reasons,
            };
        });
        if (reference.wallClockMs.spreadPct >= LEVER_MAX_SPREAD_PCT) {
            return { rows, pick: { option: 'RERUN', sizing: null, reason: `reference spread ${reference.wallClockMs.spreadPct.toFixed(1)} % ≥ ${LEVER_MAX_SPREAD_PCT} %: the sweep is inside the noise; rerun on an idle machine or with more BENCH_REPS` } };
        }
        const passing = rows.filter(r => r.passes).sort(SweepVerdict.compareWinners);
        if (passing.length === 0) return { rows, pick: { option: 'B', sizing: reference.sizing, reason: `no candidate clears the ${LEVER_MIN_GAIN_PCT} %-median rule; keep the base sizing (the constant stays a lever-2 knob)` } };
        const best = passing[0];
        return { rows, pick: { option: 'A', sizing: best.sizing, reason: `wall-clock −${best.gainPct.toFixed(1)} %, embed −${best.embedGainPct.toFixed(1)} % vs reference, spread ${best.wallClockMs.spreadPct.toFixed(1)} %` } };
    }

    // Ticket tie-break: wall-clock gain (whole percent — sub-percent differences
    // are noise), then embed gain, then the SMALLER budget (shorter worst-case
    // UI stall for free), then the smaller max.
    static compareWinners(a, b) {
        return (Math.round(b.gainPct) - Math.round(a.gainPct))
            || (b.embedGainPct - a.embedGainPct)
            || (a.sizing.budgetTokens - b.sizing.budgetTokens)
            || (a.sizing.maxBatch - b.sizing.maxBatch);
    }
}

export class SweepReport {
    static ms(n) { return n == null ? '—' : n.toFixed(0); }
    static pct(n) { return n == null ? '—' : `${n.toFixed(1)} %`; }
    static num(n, digits = 2) { return n == null ? '—' : Number(n).toFixed(digits); }
    static signedPct(n) { return n == null ? '—' : `${n >= 0 ? '−' : '+'}${Math.abs(n).toFixed(1)} %`; }

    static tableRow(row, label) {
        const notes = row.failed ? `FAILED: ${row.failed}` : row.reasons?.join('; ') ?? '';
        const cells = [
            label ?? BatchSizingSpec.format(row.sizing),
            row.gridPasses ?? '—',
            row.failed ? '—' : SweepReport.ms(row.wallClockMs.median),
            row.failed ? '—' : SweepReport.ms(row.embedDurationMs.median),
            row.failed ? '—' : row.embedDispatches,
            row.failed ? '—' : SweepReport.num(row.effectiveBatch),
            row.failed ? '—' : SweepReport.ms(row.p95BatchMs),
            row.failed ? '—' : SweepReport.pct(row.wallClockMs.spreadPct),
            row.warmupColdMs == null ? 'skipped (fingerprint hit)' : SweepReport.ms(row.warmupColdMs),
            row.gainPct === undefined ? 'reference' : SweepReport.signedPct(row.gainPct),
            row.passes === undefined ? '' : row.passes ? 'PASS' : 'FAIL',
            notes,
        ];
        return `| ${cells.join(' | ')} |`;
    }

    /**
     * Markdown the human pastes into the ticket. `context`: { machine, git,
     * device, files, reps, adapter, date }.
     */
    static render({ context, reference, verdict }) {
        const header = '| candidate (budget/max) | grid passes | wall-clock (ms) | embed (ms) | dispatches | eff. batch | p95 batch (ms) | spread | warmupMs (cold) | wall-clock vs ref | verdict | notes |';
        const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|';
        const lines = [
            `## Batch-sizing sweep — ${context.date}`,
            '',
            `- machine: ${context.machine.cpu}, ${context.machine.cores} thr, ${context.machine.platform}/${context.machine.arch}`,
            `- adapter: ${context.adapter ? `${context.adapter.vendor}/${context.adapter.architecture} (${context.adapter.classification})` : 'unknown'}`,
            `- commit: ${context.git.commit}${context.git.dirty ? ' (dirty)' : ''} · device: ${context.device} · files: ${context.files} · measured runs per candidate: ${context.reps}`,
            `- rule: median wall-clock gain ≥ ${LEVER_MIN_GAIN_PCT} % vs the reference, spread < ${LEVER_MAX_SPREAD_PCT} % on both, zero embed recycles`,
            '',
            header, sep,
            SweepReport.tableRow(reference, `${BatchSizingSpec.format(reference.sizing)} (reference)`),
            ...verdict.rows.map(r => SweepReport.tableRow(r)),
            '',
            SweepReport.pickLine(verdict.pick),
            '',
        ];
        return lines.join('\n');
    }

    static pickLine(pick) {
        if (pick.option === 'RERUN') return `**VERDICT: inconclusive — ${pick.reason}.**`;
        const spec = BatchSizingSpec.format(pick.sizing);
        const constant = `DESKTOP_WEBGPU_BATCH_SIZING = { budgetTokens: ${pick.sizing.budgetTokens}, maxBatch: ${pick.sizing.maxBatch} }`;
        return `**VERDICT: option ${pick.option} — set \`${constant}\` in \`src/batch-sizing.ts\` (${spec}: ${pick.reason}).**`;
    }
}
