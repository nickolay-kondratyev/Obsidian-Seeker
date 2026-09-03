#!/usr/bin/env node
// Batch-sizing sweep for lever 1 (ticket nid_0yhtxzgrmly7zk6m6quiqfpil_e):
// the ONE command the human runs on the GPU host to pick
// DESKTOP_WEBGPU_BATCH_SIZING (src/batch-sizing.ts). Docs: docs/perf-bench.md,
// "Lever 1".
//
//   npm run bench:sweep                     # reference 512/8 + the 6 candidates, 70 files
//   BENCH_CANDIDATES=2048/16,2048/32 npm run bench:sweep
//
// For every sizing it runs one bench session (scripts/bench.mjs: 1 warm-up +
// BENCH_REPS measured runs, every line appended to .bench/results.ndjson with
// `batchSizing` + `batchSizingOverride`) with BENCH_BATCH_SIZING set, so no
// source edit is needed per candidate. The warm-up run of each sizing misses
// the warmup fingerprint (the grid is part of it), so its `warmupMs` is the
// real cold-grid warmup for that sizing. At the end it applies the 10 %-median
// rule (bench-sweep-report.mjs), prints a markdown report on stdout and writes
// it to .bench/sweep-<timestamp>.md — paste that into the ticket.
//
// Environment:
//   BENCH_CANDIDATES  comma-separated budget/max list (default DEFAULT_CANDIDATES).
//                     The reference REFERENCE_SIZING always runs first.
//   BENCH_FILES       default SWEEP_DEFAULT_FILES (70: the every-bucket prefix,
//                     where embedding dominates the headline; 12 hides the
//                     gain behind the fixed post-index pool release).
//   BENCH_REPS, BENCH_FORCE, BENCH_CHROMIUM  as for scripts/bench.mjs.
//   BENCH_DEVICE      must be unset or webgpu: the sizing only exists on desktop WebGPU.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BatchSizingSpec } from '../bench/harness/batch-sizing-spec.mjs';
import { RunStats } from './bench-math.mjs';
import { SweepVerdict, SweepReport } from './bench-sweep-report.mjs';
import { BenchError, cpuIdleGate, log, parseReps, printLaunchInfo, runBenchSession, runMain, RESULTS_FILE } from './bench.mjs';

const SWEEP_DEVICE = 'webgpu';
const SWEEP_DEFAULT_FILES = '70';
// BASE_BATCH_SIZING in src/batch-sizing.ts, run explicitly (not via the
// shipped constant) so the reference row never depends on what the code ships.
const REFERENCE_SIZING = '512/8';
const DEFAULT_CANDIDATES = '1024/16,1024/32,2048/16,2048/32,4096/16,4096/32';

function parseCandidates() {
    let parsed;
    try { parsed = BatchSizingSpec.parseList(process.env.BENCH_CANDIDATES || DEFAULT_CANDIDATES); }
    catch (e) { throw new BenchError(`BENCH_CANDIDATES: ${e.message}`); }
    const list = parsed.filter(s => BatchSizingSpec.format(s) !== REFERENCE_SIZING);
    if (list.length === 0) throw new BenchError(`BENCH_CANDIDATES needs at least one sizing other than the reference ${REFERENCE_SIZING}`);
    return list;
}

function requireSweepDevice() {
    const d = process.env.BENCH_DEVICE;
    if (d && d !== SWEEP_DEVICE) throw new BenchError(`BENCH_DEVICE=[${d}] — the sweep only makes sense on ${SWEEP_DEVICE} (desktop-WebGPU is the only surface with its own sizing). Unset it.`);
}

// One bench session → one sweep row (shape documented in bench-sweep-report.mjs).
function sweepRow(sizing, measuredRuns, env) {
    const spec = BatchSizingSpec.format(sizing);
    const started = Date.now();
    try {
        const { session, warmup, measured, summary } = runBenchSession({ benchDevice: SWEEP_DEVICE, measuredRuns, env: { ...env, BENCH_BATCH_SIZING: spec } });
        const all = [warmup, ...measured];
        log(`[${spec}] done in ${((Date.now() - started) / 1000).toFixed(0)} s: wallClock median=[${summary.wallClockMs.median.toFixed(0)} ms] spread=[${summary.wallClockMs.spreadPct.toFixed(1)}%]`);
        return {
            sizing,
            session,
            gridPasses: warmup.warmupPasses ?? null,
            wallClockMs: summary.wallClockMs,
            embedDurationMs: summary.embedDurationMs,
            embedDispatches: summary.embedDispatches.median,
            effectiveBatch: summary.effectiveBatch.median,
            p95BatchMs: RunStats.median(measured.map(r => r.embedBatchLatencyMs?.p95 ?? NaN)),
            warmupColdMs: warmup.warmupSkipped ? null : warmup.warmupMs,
            embedRecycles: Math.max(...all.map(r => r.embedRecycles ?? 0)),
            adapter: warmup.adapter ?? null,
            failed: null,
        };
    } catch (e) {
        if (!(e instanceof BenchError)) throw e;
        log(`[${spec}] FAILED: ${e.message}`);
        return { sizing, session: null, gridPasses: null, wallClockMs: null, embedDurationMs: null, embedDispatches: null, effectiveBatch: null, p95BatchMs: null, warmupColdMs: null, embedRecycles: 0, adapter: null, failed: e.message.split('\n')[0] };
    }
}

async function main() {
    requireSweepDevice();
    const candidates = parseCandidates();
    const measuredRuns = parseReps();
    // BENCH_PACING is forced to `unfocused`: since lever 2 the desktop-WebGPU
    // sizing is only in force on the unfocused / perf-mode tier, so a focused
    // sweep would measure the base sizing for every candidate (pacing-policy.ts).
    const env = { ...process.env, BENCH_DEVICE: SWEEP_DEVICE, BENCH_FILES: process.env.BENCH_FILES || SWEEP_DEFAULT_FILES, BENCH_PACING: 'unfocused' };
    process.env.BENCH_FILES = env.BENCH_FILES;   // so printLaunchInfo shows the sweep default

    printLaunchInfo(SWEEP_DEVICE);
    log(`sweep: reference [${REFERENCE_SIZING}] then candidates [${candidates.map(BatchSizingSpec.format).join(', ')}] — ${1 + candidates.length} sessions × (1 warm-up + ${measuredRuns} measured)`);
    await cpuIdleGate();

    const reference = sweepRow(BatchSizingSpec.parse(REFERENCE_SIZING), measuredRuns, env);
    // Every candidate would fail the same way (no GPU, missing Chromium, ...):
    // stop instead of paying the launch cost six more times.
    if (reference.failed) throw new BenchError(`reference [${REFERENCE_SIZING}] failed, so no candidate can be compared: ${reference.failed}`);

    const rows = [];
    candidates.forEach((sizing, i) => {
        log(`── candidate ${i + 1}/${candidates.length}: [${BatchSizingSpec.format(sizing)}] ──`);
        rows.push(sweepRow(sizing, measuredRuns, env));
    });

    const verdict = SweepVerdict.evaluate(reference, rows);
    const context = { date: new Date().toISOString(), machine: reference.session.machine, git: reference.session.git, device: SWEEP_DEVICE, files: Number(env.BENCH_FILES), reps: measuredRuns, adapter: reference.adapter };
    const md = SweepReport.render({ context, reference, verdict });

    const reportPath = join(dirname(RESULTS_FILE), `sweep-${context.date.replace(/[:.]/g, '-')}.md`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, md);
    process.stdout.write(`\n${md}\n`);
    log(`report written to [${reportPath}] — paste it into the ticket. Raw lines: [${RESULTS_FILE}]`);
}

runMain(main);
