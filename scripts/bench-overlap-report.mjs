// Pure half of the dispatch-overlap A/B (scripts/bench-overlap.mjs): the
// 10 %-median rule from docs/perf-bench.md applied to depth 2 against depth 1,
// and the markdown report the human pastes into the ticket. No I/O, unit
// tested in bench-overlap-report.test.mjs. Reuses the sweep's rule pieces so
// the two experiments can never drift on what "passes" means.
import { SweepVerdict, SweepReport, LEVER_MIN_GAIN_PCT, LEVER_MAX_SPREAD_PCT } from './bench-sweep-report.mjs';

/**
 * One A/B row, as built by bench-overlap.mjs from a bench session:
 * { depth, wallClockMs:{median,spreadPct}, embedDurationMs:{median,spreadPct},
 *   embedDispatches, effectiveBatch, p95BatchMs, embedMaxInFlight,
 *   embedRecycles, failed (error text or null) }
 */
export class OverlapVerdict {
    /** Why the candidate is out, or [] when it passes the rule against `reference`. */
    static failReasons(reference, candidate) {
        if (candidate.failed) return [`run failed: ${candidate.failed}`];
        const reasons = SweepVerdict.failReasons(reference, candidate);
        // The number is only an overlap measurement if the overlap happened.
        if (candidate.embedMaxInFlight !== candidate.depth) reasons.push(`embedMaxInFlight=${candidate.embedMaxInFlight} ≠ depth ${candidate.depth} (the dispatches never overlapped — check the pacing tier)`);
        return reasons;
    }

    /**
     * KEEP = depth 2 clears the rule, REVERT = it does not (the ticket says
     * revert the code and record the rows), RERUN = the reference is unusable.
     */
    static evaluate(reference, candidate) {
        if (reference.failed) return { option: 'RERUN', gainPct: null, embedGainPct: null, reasons: [], reason: `reference run failed: ${reference.failed}` };
        if (reference.embedMaxInFlight !== reference.depth) return { option: 'RERUN', gainPct: null, embedGainPct: null, reasons: [], reason: `reference embedMaxInFlight=${reference.embedMaxInFlight} ≠ depth ${reference.depth}: the reference is not the serial loop` };
        if (reference.wallClockMs.spreadPct >= LEVER_MAX_SPREAD_PCT) return { option: 'RERUN', gainPct: null, embedGainPct: null, reasons: [], reason: `reference spread ${reference.wallClockMs.spreadPct.toFixed(1)} % ≥ ${LEVER_MAX_SPREAD_PCT} %: inside the noise; rerun on an idle machine or with more BENCH_REPS` };
        const reasons = OverlapVerdict.failReasons(reference, candidate);
        const gainPct = candidate.failed ? null : SweepVerdict.gainPct(reference.wallClockMs.median, candidate.wallClockMs.median);
        const embedGainPct = candidate.failed ? null : SweepVerdict.gainPct(reference.embedDurationMs.median, candidate.embedDurationMs.median);
        if (reasons.length > 0) return { option: 'REVERT', gainPct, embedGainPct, reasons, reason: reasons.join('; ') };
        return { option: 'KEEP', gainPct, embedGainPct, reasons, reason: `wall-clock −${gainPct.toFixed(1)} %, embed −${embedGainPct.toFixed(1)} % vs depth 1, spread ${candidate.wallClockMs.spreadPct.toFixed(1)} %` };
    }
}

export class OverlapReport {
    static tableRow(row, { gainPct, verdict, notes }) {
        const f = row.failed;
        const cells = [
            `depth ${row.depth}`,
            f ? '—' : SweepReport.ms(row.wallClockMs.median),
            f ? '—' : SweepReport.ms(row.embedDurationMs.median),
            f ? '—' : row.embedDispatches,
            f ? '—' : SweepReport.num(row.effectiveBatch),
            f ? '—' : SweepReport.ms(row.p95BatchMs),
            f ? '—' : row.embedMaxInFlight,
            f ? '—' : SweepReport.pct(row.wallClockMs.spreadPct),
            gainPct === undefined ? 'reference' : SweepReport.signedPct(gainPct),
            verdict ?? '',
            f ? `FAILED: ${f}` : notes ?? '',
        ];
        return `| ${cells.join(' | ')} |`;
    }

    /** Markdown for the ticket + docs/perf-bench.md. `context`: { machine, git, device, files, reps, adapter, date, pacing }. */
    static render({ context, reference, candidate, verdict }) {
        const header = '| dispatch depth | wall-clock (ms) | embed (ms) | dispatches | eff. batch | p95 batch (ms) | max in flight | spread | wall-clock vs depth 1 | verdict | notes |';
        const sep = '|---|---|---|---|---|---|---|---|---|---|---|';
        const lines = [
            `## Dispatch-overlap A/B — ${context.date}`,
            '',
            `- machine: ${context.machine.cpu}, ${context.machine.cores} thr, ${context.machine.platform}/${context.machine.arch}`,
            `- adapter: ${context.adapter ? `${context.adapter.vendor}/${context.adapter.architecture} (${context.adapter.classification})` : 'unknown'}`,
            `- commit: ${context.git.commit}${context.git.dirty ? ' (dirty)' : ''} · device: ${context.device} · pacing: ${context.pacing} · files: ${context.files} · measured runs per depth: ${context.reps}`,
            `- rule: median wall-clock gain ≥ ${LEVER_MIN_GAIN_PCT} % vs depth 1, spread < ${LEVER_MAX_SPREAD_PCT} % on both, zero embed recycles, max in flight = depth`,
            '',
            header, sep,
            OverlapReport.tableRow(reference, { verdict: '', notes: 'serial loop (reference)' }),
            OverlapReport.tableRow(candidate, { gainPct: verdict.gainPct, verdict: verdict.option === 'RERUN' ? '' : verdict.option === 'KEEP' ? 'PASS' : 'FAIL', notes: verdict.reasons.join('; ') }),
            '',
            OverlapReport.verdictLine(verdict),
            '',
        ];
        return lines.join('\n');
    }

    static verdictLine(verdict) {
        if (verdict.option === 'RERUN') return `**VERDICT: inconclusive — ${verdict.reason}.**`;
        if (verdict.option === 'KEEP') return `**VERDICT: KEEP — depth 2 clears the rule (${verdict.reason}). Keep \`DESKTOP_WEBGPU_DISPATCH_DEPTH = 2\` in \`src/pacing-policy.ts\` and paste this table into docs/perf-bench.md.**`;
        return `**VERDICT: REVERT — depth 2 does not clear the rule (${verdict.reason}). Set \`DESKTOP_WEBGPU_DISPATCH_DEPTH = 1\` (or revert the overlap commit) and paste this table into docs/perf-bench.md so nobody retries blind.**`;
    }
}
