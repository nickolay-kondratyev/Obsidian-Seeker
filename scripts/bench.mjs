#!/usr/bin/env node
// Indexing-performance bench runner: wraps bench/harness/run.mjs with the
// ergonomics a lever ticket needs to trust a number. Docs: docs/perf-bench.md.
//
//   npm run bench                      # container: BENCH_DEVICE=wasm, system Chromium
//   npm run bench:host                 # host:      BENCH_DEVICE=webgpu (real GPU required)
//   BENCH_DEVICE=wasm npm run bench:host   # env always overrides the script default
//
// What one invocation does, in order:
//   1. Prints the Chromium executable + flags the harness will use (imported
//      from the harness's DEVICE_PROFILES table — the ONE place flags live).
//   2. CPU-idle gate: samples CPU for CPU_GATE_WINDOW_MS; aborts (exit 2) when
//      busy > CPU_BUSY_THRESHOLD unless BENCH_FORCE=1.
//   3. Spawns the harness WARMUP_RUNS + measured runs (BENCH_REPS, default
//      DEFAULT_MEASURED_RUNS) times, parsing the one JSON object each prints.
//   4. Appends one JSON line per run (warm-up included, tagged) to
//      .bench/results.ndjson (git-ignored) with machine + git info.
//   5. Prints median + min/max spread per metric for the measured runs.
//
// Steps 3-4 are `runBenchSession` (exported): scripts/bench-sweep.mjs runs one
// session per batch-sizing candidate and reports across them.
//
// Environment (all optional; everything else is passed through to the harness —
// see the header of bench/harness/run.mjs for BENCH_FILES, BENCH_CHROMIUM, ...):
//   BENCH_DEVICE   overrides the --default-device the npm script sets.
//   BENCH_REPS=N   measured runs (default DEFAULT_MEASURED_RUNS). Warm-up is always 1.
//   BENCH_FORCE=1  run even when the CPU-idle gate says the machine is busy.
import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { chromiumArgs, resolveChromiumPath, DEFAULT_BENCH_FILES } from '../bench/harness/run.mjs';
import { CpuGate, CpuSample, RunStats, CPU_GATE_WINDOW_MS, CPU_BUSY_THRESHOLD } from './bench-math.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HARNESS = join(REPO_ROOT, 'bench', 'harness', 'run.mjs');
export const RESULTS_FILE = join(REPO_ROOT, '.bench', 'results.ndjson');
const WARMUP_RUNS = 1;
const DEFAULT_MEASURED_RUNS = 3;
const PROC_STAT = '/proc/stat';
export const EXIT_GATE_BUSY = 2;

export function log(msg) { process.stderr.write(`bench-runner: ${msg}\n`); }

// Thrown by every step below instead of exiting, so a caller running several
// sessions (the sweep) can decide what to do; `main` maps it to an exit code.
export class BenchError extends Error {
    constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    let defaultDevice = 'wasm';
    for (const a of argv) {
        const m = /^--default-device=(.+)$/.exec(a);
        if (m) defaultDevice = m[1];
        else throw new BenchError(`unknown argument [${a}]. Usage: node scripts/bench.mjs [--default-device=wasm|webgpu]`);
    }
    return { defaultDevice };
}

export function parseReps() {
    if (!process.env.BENCH_REPS) return DEFAULT_MEASURED_RUNS;
    const n = Number(process.env.BENCH_REPS);
    if (!Number.isInteger(n) || n <= 0) throw new BenchError(`BENCH_REPS must be a positive integer, got [${process.env.BENCH_REPS}]`);
    return n;
}

export function parseBenchFiles() {
    return process.env.BENCH_FILES ? Number(process.env.BENCH_FILES) : DEFAULT_BENCH_FILES;
}

// ── launch info (step 1) ────────────────────────────────────────────────────
export function printLaunchInfo(benchDevice) {
    const executable = resolveChromiumPath() ?? chromium.executablePath();
    const args = chromiumArgs(benchDevice);
    log(`device=[${benchDevice}] files=[${parseBenchFiles()}]`);
    log(`chromium=[${executable}]${existsSync(executable) ? '' : ' (NOT FOUND — run `npm run bench:setup`)'}`);
    log(`flags=[${args.join(' ')}]`);
}

// ── CPU-idle gate (step 2) ──────────────────────────────────────────────────
function sampleCpu() {
    if (existsSync(PROC_STAT)) return CpuSample.fromProcStat(readFileSync(PROC_STAT, 'utf8'));
    return CpuSample.fromOsCpus(os.cpus());
}

export async function cpuIdleGate() {
    const before = sampleCpu();
    await new Promise(r => setTimeout(r, CPU_GATE_WINDOW_MS));
    const busy = CpuGate.busyFraction(before, sampleCpu());
    const pct = (busy * 100).toFixed(0);
    if (!CpuGate.isTooBusy(busy)) { log(`cpu-idle gate: busy=[${pct}%] over ${CPU_GATE_WINDOW_MS} ms — ok`); return; }
    if (process.env.BENCH_FORCE === '1') { log(`cpu-idle gate: busy=[${pct}%] — BENCH_FORCE=1 set, running anyway (numbers may be noisy)`); return; }
    throw new BenchError(`The machine is busy (CPU ${pct}% over the last ${CPU_GATE_WINDOW_MS / 1000} s, limit ${CPU_BUSY_THRESHOLD * 100}%), so bench numbers would be noise.\n` +
        `  Close or wait for the other work and rerun, or set BENCH_FORCE=1 to run anyway.`, EXIT_GATE_BUSY);
}

// ── harness runs (step 3) ───────────────────────────────────────────────────
function runHarness(label, env) {
    log(`── ${label} ──`);
    const started = Date.now();
    const child = spawnSync(process.execPath, [HARNESS], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (child.status !== 0) throw new BenchError(`harness exited with status [${child.status}] during [${label}]; see its output above. No results recorded.`);
    let result;
    try { result = JSON.parse(child.stdout); } catch (e) { throw new BenchError(`harness printed something other than one JSON object during [${label}]: ${e.message}\n${child.stdout}`); }
    log(`${label}: wallClock=[${result.wallClockMs} ms] chunks/s=[${result.chunksPerSec}] dispatches=[${result.embedDispatches}] (${((Date.now() - started) / 1000).toFixed(1)} s incl. launch)`);
    return result;
}

// ── results ndjson (step 4) ─────────────────────────────────────────────────
function git(args) {
    try { return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; }
}

export function machineInfo() {
    return { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, platform: process.platform, arch: process.arch, hostname: os.hostname() };
}

export function gitInfo() {
    const commit = git(['rev-parse', '--short', 'HEAD']);
    const dirty = (git(['status', '--porcelain']) ?? '') !== '';
    return { commit, dirty };
}

function appendResult(line) {
    mkdirSync(join(REPO_ROOT, '.bench'), { recursive: true });
    appendFileSync(RESULTS_FILE, JSON.stringify(line) + '\n');
}

// ── one session = warm-up + measured runs on ONE configuration (steps 3-4) ──
// `env` is the harness environment (BENCH_DEVICE must already be set in it).
// Returns the warm-up result (its load entry carries the cold warmupMs after a
// fingerprint miss), the measured results, and their RunStats summary.
export function runBenchSession({ benchDevice, measuredRuns, env = process.env }) {
    const session = { machine: machineInfo(), git: gitInfo(), benchDevice, benchFiles: parseBenchFiles() };
    const measured = [];
    let warmup = null;
    const total = WARMUP_RUNS + measuredRuns;
    for (let i = 0; i < total; i++) {
        const isWarmup = i < WARMUP_RUNS;
        const rep = isWarmup ? i + 1 : i - WARMUP_RUNS + 1;
        const label = isWarmup ? `warm-up ${rep}/${WARMUP_RUNS}` : `measured ${rep}/${measuredRuns}`;
        const result = runHarness(label, env);
        appendResult({ date: new Date().toISOString(), ...session, phase: isWarmup ? 'warmup' : 'measured', rep, adapter: result.adapter ?? null, actualDevice: result.actualDevice, result });
        if (isWarmup) warmup = result; else measured.push(result);
    }
    return { session, warmup, measured, summary: RunStats.summarize(measured) };
}

// ── report (step 5) ─────────────────────────────────────────────────────────
function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2); }

function printSummary(summary, measuredCount) {
    const rows = Object.entries(summary).map(([metric, s]) => [metric, fmt(s.median), fmt(s.min), fmt(s.max), `${s.spreadPct.toFixed(1)}%`]);
    const header = ['metric', 'median', 'min', 'max', 'spread'];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
    const line = cells => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
    process.stdout.write(`\n${line(header)}\n${line(widths.map(w => '-'.repeat(w)))}\n${rows.map(line).join('\n')}\n`);
    process.stdout.write(`\n(${measuredCount} measured runs; spread = (max - min) / median. Full lines in ${RESULTS_FILE})\n`);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
    const { defaultDevice } = parseArgs(process.argv.slice(2));
    const benchDevice = process.env.BENCH_DEVICE || defaultDevice;
    process.env.BENCH_DEVICE = benchDevice;               // the harness reads it
    const measuredRuns = parseReps();

    printLaunchInfo(benchDevice);
    await cpuIdleGate();
    const { measured, summary } = runBenchSession({ benchDevice, measuredRuns });
    printSummary(summary, measured.length);
}

// Exit-code mapping lives only here: a BenchError is a message + code, an
// unexpected throw keeps its stack.
export async function runMain(mainFn) {
    try { await mainFn(); }
    catch (e) {
        if (e instanceof BenchError) { log(e.message); process.exit(e.exitCode); }
        log(e?.stack ?? String(e)); process.exit(1);
    }
}

// Guarded so bench-sweep.mjs can import the session without running a bench.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    runMain(main);
}
