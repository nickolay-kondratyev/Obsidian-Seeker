#!/usr/bin/env node
// Full-reindex throughput bench on the REAL embedder, in a real Chromium page.
// Ticket nid_pt77674z2iel2w8rmdga3bvkb_e (plan nid_mw6gkmuurjhiqva4rr6doenul_e).
//
//   node bench/harness/run.mjs                       # wasm, default corpus prefix
//   BENCH_DEVICE=webgpu node bench/harness/run.mjs   # host with a real GPU only
//   BENCH_DEVICE=webgpu-absent BENCH_PROBE=1 node bench/harness/run.mjs
//
// Prints ONE JSON object on stdout (everything else goes to stderr). Exit code
// is non-zero, with no JSON, when the run cannot be trusted (webgpu mode not on
// a real GPU adapter, Chromium failed to launch, ...).
//
// Environment:
//   BENCH_DEVICE   wasm (default) | webgpu | webgpu-software | webgpu-absent —
//                  selects the Chromium flag set AND the device handed to
//                  LocalEmbedder.load() (table DEVICE_PROFILES below).
//   BENCH_PROBE=1  load the model, print the load entry + resolved backend,
//                  exit without indexing.
//   BENCH_FILES=N  index only the first N corpus files (sorted path order).
//                  Default DEFAULT_BENCH_FILES: chosen so the cache-warm wasm
//                  run finishes in < 20 s inside the dev container (no GPU,
//                  ~4 wasm threads); bench/corpus.test.ts pins that this prefix
//                  still spans every seq bucket.
//   BENCH_CHROMIUM path to a Chromium binary. Default: /usr/bin/chromium when
//                  present (the container), else Playwright's bundled Chromium
//                  (host, installed once by `npx playwright-core install chromium`).
//   BENCH_CACHE_DIR persistent Chromium profile (default .bench-cache/ at repo
//                  root). Holds the HTTP cache + Cache API entries transformers.js
//                  writes the model into + Dawn's shader cache, so only the
//                  first run pays for the ~100 MB model download.
//   BENCH_PORT     local HTTP port for the bench page (default 47331). Fixed,
//                  not random, because Cache API / IndexedDB / localStorage are
//                  origin-scoped: a new port would be a new origin and a cold cache.
//
// Why a standalone Playwright script and not vitest browser mode: see the
// DECISION section of the ticket. Short version: only launchPersistentContext
// keeps the model cache between runs, and that needs full control of the
// browser launch.
//
// The serve/launch/persistent-profile plumbing (and BASE_CHROMIUM_ARGS /
// resolveChromiumPath / the port + cache-dir constants) lives in ./browser.mjs,
// shared with the retrieval e2e runner (e2e/harness/run.mjs). This file keeps the
// bench-specific bits: the DEVICE_PROFILES flag table, the corpus reader, and the
// probe/run result shaping.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBenchBundle } from './esbuild.mjs';
import { BASE_CHROMIUM_ARGS, resolveChromiumPath, DEFAULT_PORT, DEFAULT_CACHE_DIR, withBrowserPage } from './browser.mjs';

// Re-exported for scripts/bench.mjs, which imports resolveChromiumPath from here.
export { resolveChromiumPath, BASE_CHROMIUM_ARGS } from './browser.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_DIR = join(REPO_ROOT, 'bench', 'corpus');
// 12 files ≈ 67 chunks ≈ 16.5 s warm wasm in the dev container (~4 chunks/s:
// single-threaded ORT kernels, as in production). Host runs should pass
// BENCH_FILES=70 (bucket-coverage prefix pinned by bench/corpus.test.ts) or the
// full corpus.
export const DEFAULT_BENCH_FILES = 12;

// ── the ONE table of per-device Chromium flags + embedder device ────────────
// `bench:host` (ergonomics ticket) prints these; it must import this table, not
// copy it. `requireRealGpu` makes the run FAIL unless the load landed on webgpu
// with a `real` adapter classification (gpu-adapter.ts), so a webgpu number
// can never silently be a SwiftShader or wasm number.
export const DEVICE_PROFILES = {
    wasm: { load: 'wasm', args: [], requireRealGpu: false },
    // Linux only: verified on the reference host (Fedora, Ryzen AI MAX+ 395 /
    // Radeon 8060S), Linux Chromium ships WebGPU behind these Vulkan flags.
    // macOS Chromium ships WebGPU on by default over Metal, and forcing the
    // Vulkan ANGLE backend there would break the GPU path, so no flags.
    // `requireRealGpu` still fails the run loudly if that assumption is wrong.
    webgpu: {
        load: 'auto',
        args: process.platform === 'linux'
            ? ['--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
            : [],
        requireRealGpu: true,
    },
    // No real GPU → Chromium exposes its SwiftShader (vendor `google`) adapter.
    // Used by the software-adapter rejection test.
    'webgpu-software': { load: 'auto', args: ['--enable-unsafe-webgpu'], requireRealGpu: false },
    // No GPU flags, 'auto' requested: must land on wasm (adapter none).
    'webgpu-absent': { load: 'auto', args: [], requireRealGpu: false },
};

export function chromiumArgs(benchDevice) {
    return [...BASE_CHROMIUM_ARGS, ...profileFor(benchDevice).args];
}

function profileFor(benchDevice) {
    const p = DEVICE_PROFILES[benchDevice];
    if (!p) fail(`BENCH_DEVICE=${benchDevice} is not one of: ${Object.keys(DEVICE_PROFILES).join(', ')}`);
    return p;
}

function fail(msg) {
    process.stderr.write(`bench: ${msg}\n`);
    process.exit(1);
}

function log(msg) {
    process.stderr.write(`bench: ${msg}\n`);
}

// ── corpus ──────────────────────────────────────────────────────────────────
export function readCorpus(maxFiles) {
    const names = readdirSync(CORPUS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md').sort();
    return names.slice(0, maxFiles).map(name => ({ path: name, content: readFileSync(join(CORPUS_DIR, name), 'utf8') }));
}

// ── result shaping ──────────────────────────────────────────────────────────
function summarizeLoad(benchDevice, probe) {
    const l = probe.load;
    return {
        benchDevice,
        requestedDevice: l.requestedDevice,
        actualDevice: l.actualDevice,
        dtype: l.dtype,
        adapter: l.adapter,
        resolvedReason: l.resolvedReason,
        resolvedBackend: probe.resolvedBackend,
        webgpuError: l.webgpuError,
        coldStartMs: l.coldStartMs,
        warmupMs: l.warmupMs,
        warmupSkipped: l.warmupSkipped,
        // budget/max the indexer flushed with (batch-sizing.ts) — makes a
        // results.ndjson row self-describing without reading the commit.
        batchSizing: probe.batchSizing ?? null,
    };
}

function summarizeRun(benchDevice, run) {
    const i = run.index;
    const dispatches = i.embedBatchLatencyMs?.n ?? 0;
    return {
        ...summarizeLoad(benchDevice, run),
        wallClockMs: run.wallClockMs,
        files: i.filesIndexed,
        filesCommitted: i.committedFilePaths.length,
        chunks: i.chunksIndexed,
        vectors: i.vectorsWritten,
        filesPerSec: i.filesPerSec,
        chunksPerSec: i.chunksPerSec,
        embedDispatches: dispatches,
        effectiveBatch: dispatches > 0 ? parseFloat((i.vectorsWritten / dispatches).toFixed(2)) : 0,
        paddedTokens: run.paddedTokens,
        paceWaitMs: i.paceWaitMs ?? null,
        embedBatchLatencyMs: i.embedBatchLatencyMs,
        // Non-zero = a dispatch hit ORT-Web's WebGPU overflow path and the
        // session was rebuilt (embedder.recycle); a run that does this is suspect.
        embedRecycles: i.embedRecycles ?? 0,
        embedDurationMs: i.embedDurationMs,
        chunkDurationMs: i.chunkDurationMs,
        bm25DurationMs: i.bm25DurationMs,
        commitDurationMs: i.commitDurationMs,
        totalDurationMs: i.totalDurationMs,
        filesSkippedError: i.filesSkippedError,
        indexPass: i.pass,
        checks: i.checks,
    };
}

function assertTrustedDevice(benchDevice, probe) {
    if (!profileFor(benchDevice).requireRealGpu) return;
    const l = probe.load;
    const cls = l.adapter?.classification ?? 'none';
    if (l.actualDevice === 'webgpu' && cls === 'real') return;
    process.stderr.write(JSON.stringify(l, null, 2) + '\n');
    fail(`BENCH_DEVICE=${benchDevice} requires a REAL GPU adapter but the load landed on ` +
        `device=${l.actualDevice} adapter=${cls} (webgpuError=${l.webgpuError ?? 'null'}, reason=${l.resolvedReason ?? 'null'}). ` +
        `No result printed. On Linux see the flags in DEVICE_PROFILES.webgpu; inside the dev container real WebGPU is impossible (no /dev/dri).`);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
    const benchDevice = process.env.BENCH_DEVICE || 'wasm';
    const profile = profileFor(benchDevice);
    const probeOnly = process.env.BENCH_PROBE === '1';
    const benchFiles = process.env.BENCH_FILES ? Number(process.env.BENCH_FILES) : DEFAULT_BENCH_FILES;
    if (!Number.isInteger(benchFiles) || benchFiles <= 0) fail(`BENCH_FILES must be a positive integer, got [${process.env.BENCH_FILES}]`);
    const port = process.env.BENCH_PORT ? Number(process.env.BENCH_PORT) : DEFAULT_PORT;
    const cacheDir = resolve(REPO_ROOT, process.env.BENCH_CACHE_DIR || DEFAULT_CACHE_DIR);
    const executablePath = resolveChromiumPath();
    const args = chromiumArgs(benchDevice);

    log(`bundling bench page`);
    const bundle = await buildBenchBundle();

    log(`launching chromium [${executablePath ?? 'playwright-bundled'}] args=[${args.join(' ')}] profile=[${cacheDir}]`);
    await withBrowserPage({ bundle, port, cacheDir, executablePath, args, readyGlobal: '__seekerBench', log }, async (page, { chromiumVersion }) => {
        const meta = {
            timestamp: new Date().toISOString(),
            chromium: { executablePath: executablePath ?? 'playwright-bundled', version: chromiumVersion, args },
            cacheDir,
        };

        if (probeOnly) {
            log(`probe: loading model with device=[${profile.load}]`);
            const probe = await page.evaluate(d => window.__seekerBench.probe(d), profile.load);
            assertTrustedDevice(benchDevice, probe);
            const out = { mode: 'probe', ...summarizeLoad(benchDevice, probe), load: probe.load, meta: { ...meta, model: probe.modelRepo, documentHidden: probe.documentHidden } };
            process.stdout.write(JSON.stringify(out, null, 2) + '\n');
            return;
        }

        const files = readCorpus(benchFiles);
        log(`run: device=[${profile.load}] files=[${files.length}] (first-ever run also downloads the model; later runs hit the profile cache)`);
        const run = await page.evaluate(({ d, files }) => window.__seekerBench.run(d, files), { d: profile.load, files });
        assertTrustedDevice(benchDevice, run);
        const out = { mode: 'run', ...summarizeRun(benchDevice, run), meta: { ...meta, model: run.modelRepo, benchFiles: files.length, documentHidden: run.documentHidden } };
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    });
}

// Guarded so `bench:host` can import DEVICE_PROFILES / chromiumArgs without running a bench.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch(e => fail(e?.stack ?? String(e)));
}
