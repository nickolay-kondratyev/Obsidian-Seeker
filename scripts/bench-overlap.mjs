#!/usr/bin/env node
// Dispatch-overlap A/B for experiment nid_shw3c2udyuva92sa81oa5qxyg_e: the ONE
// command the human runs on the GPU host to decide whether the two-deep embed
// dispatch overlap (src/pacing-policy.ts DESKTOP_WEBGPU_DISPATCH_DEPTH, flush
// loop in src/search.ts) stays or is reverted. Docs: docs/perf-bench.md,
// "Experiment — two-deep dispatch overlap".
//
//   npm run bench:overlap          # depth 1 (reference) then depth 2, 70 files, unfocused
//
// Both depths run from the same commit as normal bench sessions
// (scripts/bench.mjs: 1 warm-up + BENCH_REPS measured runs, every line in
// .bench/results.ndjson with `dispatchDepth` + `dispatchDepthOverride`) with
// BENCH_DISPATCH_DEPTH set, so no source edit is needed for the reference. At
// the end it applies the 10 %-median rule (bench-overlap-report.mjs), prints a
// markdown report on stdout and writes it to .bench/overlap-<timestamp>.md —
// paste that into the ticket and docs/perf-bench.md.
//
// Environment:
//   BENCH_FILES       default OVERLAP_DEFAULT_FILES (70: where embedding
//                     dominates the headline).
//   BENCH_REPS, BENCH_FORCE, BENCH_CHROMIUM  as for scripts/bench.mjs.
//   BENCH_DEVICE      must be unset or webgpu: only desktop WebGPU overlaps.
//   BENCH_PACING      must be unset, unfocused or perf-mode: the focused tier
//                     is single-flight by design, so it cannot be measured.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RunStats } from './bench-math.mjs';
import { OverlapVerdict, OverlapReport } from './bench-overlap-report.mjs';
import { BenchError, cpuIdleGate, log, parseReps, printLaunchInfo, runBenchSession, runMain, RESULTS_FILE } from './bench.mjs';

const OVERLAP_DEVICE = 'webgpu';
const OVERLAP_DEFAULT_FILES = '70';
const OVERLAP_DEFAULT_PACING = 'unfocused';
const OVERLAP_PACINGS = ['unfocused', 'perf-mode'];
// SINGLE_FLIGHT / DESKTOP_WEBGPU_DISPATCH_DEPTH in src/pacing-policy.ts, run
// explicitly so the reference row never depends on what the code ships.
const REFERENCE_DEPTH = 1;
const CANDIDATE_DEPTH = 2;

function requireOverlapDevice() {
    const d = process.env.BENCH_DEVICE;
    if (d && d !== OVERLAP_DEVICE) throw new BenchError(`BENCH_DEVICE=[${d}] — the overlap A/B only makes sense on ${OVERLAP_DEVICE} (the only surface that overlaps). Unset it.`);
}

function parseOverlapPacing() {
    const p = process.env.BENCH_PACING || OVERLAP_DEFAULT_PACING;
    if (!OVERLAP_PACINGS.includes(p)) throw new BenchError(`BENCH_PACING=[${p}] — the focused tier is single-flight by design (pacing-policy.ts); use one of: ${OVERLAP_PACINGS.join(', ')}`);
    return p;
}

// One bench session → one A/B row (shape documented in bench-overlap-report.mjs).
function overlapRow(depth, measuredRuns, env) {
    const started = Date.now();
    try {
        const { session, warmup, measured, summary } = runBenchSession({ benchDevice: OVERLAP_DEVICE, measuredRuns, env: { ...env, BENCH_DISPATCH_DEPTH: String(depth) } });
        const all = [warmup, ...measured];
        log(`[depth ${depth}] done in ${((Date.now() - started) / 1000).toFixed(0)} s: wallClock median=[${summary.wallClockMs.median.toFixed(0)} ms] spread=[${summary.wallClockMs.spreadPct.toFixed(1)}%] maxInFlight=[${summary.embedMaxInFlight?.median ?? 'n/a'}]`);
        return {
            depth,
            session,
            wallClockMs: summary.wallClockMs,
            embedDurationMs: summary.embedDurationMs,
            embedDispatches: summary.embedDispatches.median,
            effectiveBatch: summary.effectiveBatch.median,
            p95BatchMs: RunStats.median(measured.map(r => r.embedBatchLatencyMs?.p95 ?? NaN)),
            embedMaxInFlight: Math.max(...measured.map(r => r.embedMaxInFlight ?? 0)),
            embedRecycles: Math.max(...all.map(r => r.embedRecycles ?? 0)),
            adapter: warmup.adapter ?? null,
            failed: null,
        };
    } catch (e) {
        if (!(e instanceof BenchError)) throw e;
        log(`[depth ${depth}] FAILED: ${e.message}`);
        return { depth, session: null, wallClockMs: null, embedDurationMs: null, embedDispatches: null, effectiveBatch: null, p95BatchMs: null, embedMaxInFlight: null, embedRecycles: 0, adapter: null, failed: e.message.split('\n')[0] };
    }
}

async function main() {
    requireOverlapDevice();
    const pacing = parseOverlapPacing();
    const measuredRuns = parseReps();
    const env = { ...process.env, BENCH_DEVICE: OVERLAP_DEVICE, BENCH_FILES: process.env.BENCH_FILES || OVERLAP_DEFAULT_FILES, BENCH_PACING: pacing };
    process.env.BENCH_FILES = env.BENCH_FILES;   // so printLaunchInfo shows the A/B default

    printLaunchInfo(OVERLAP_DEVICE);
    log(`overlap A/B: depth ${REFERENCE_DEPTH} (reference) then depth ${CANDIDATE_DEPTH}, pacing [${pacing}] — 2 sessions × (1 warm-up + ${measuredRuns} measured)`);
    await cpuIdleGate();

    const reference = overlapRow(REFERENCE_DEPTH, measuredRuns, env);
    if (reference.failed) throw new BenchError(`reference [depth ${REFERENCE_DEPTH}] failed, so depth ${CANDIDATE_DEPTH} cannot be compared: ${reference.failed}`);
    const candidate = overlapRow(CANDIDATE_DEPTH, measuredRuns, env);

    const verdict = OverlapVerdict.evaluate(reference, candidate);
    const context = { date: new Date().toISOString(), machine: reference.session.machine, git: reference.session.git, device: OVERLAP_DEVICE, pacing, files: Number(env.BENCH_FILES), reps: measuredRuns, adapter: reference.adapter };
    const md = OverlapReport.render({ context, reference, candidate, verdict });

    const reportPath = join(dirname(RESULTS_FILE), `overlap-${context.date.replace(/[:.]/g, '-')}.md`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, md);
    process.stdout.write(`\n${md}\n`);
    log(`report written to [${reportPath}] — paste it into the ticket + docs/perf-bench.md. Raw lines: [${RESULTS_FILE}]`);
}

runMain(main);
