#!/usr/bin/env node
// Retrieval-quality e2e runner (plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e,
// ticket nid_tthbuk08rra4lyenl50t6de1c_e — part 2 of 3).
//
// Indexes the FROZEN CQADupstack-android subset (e2e/datasets/cqadupstack-android/)
// through the REAL production stack in a real Chromium page and runs every query,
// then prints ONE JSON object on stdout (all logs go to stderr) that
// e2e/retrieval.e2e.test.ts turns into ranking metrics. Reuses the bench harness's
// Chromium launch + persistent model-cache profile (bench/harness/browser.mjs) and
// device flag table (bench/harness/run.mjs); bench and e2e therefore SHARE the
// .bench-cache profile and cannot run concurrently.
//
//   node e2e/harness/run.mjs                 # wasm, default (hybrid) channel only
//   E2E_CHANNELS=1 node e2e/harness/run.mjs  # + dense-only (α=1) and bm25-only (α=0)
//
// Environment:
//   E2E_DEVICE      wasm (default) | webgpu | ... — a key of DEVICE_PROFILES
//                   (bench/harness/run.mjs); selects the Chromium flags + the
//                   device handed to LocalEmbedder.load().
//   E2E_CHANNELS=1  also run the dense-only (denseWeight 1) and bm25-only
//                   (denseWeight 0) passes. Each re-embeds every query (~8 s on
//                   wasm) and is REPORTED, never gated. Default: only the shipped
//                   hybrid denseWeight (DEFAULT_SETTINGS.denseWeight).
//   BENCH_CHROMIUM / BENCH_CACHE_DIR / BENCH_PORT — as in the bench (shared
//                   profile + origin), see bench/harness/run.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBenchBundle } from '../../bench/harness/esbuild.mjs';
import { DEVICE_PROFILES, chromiumArgs, resolveChromiumPath } from '../../bench/harness/run.mjs';
import { withBrowserPage, DEFAULT_PORT, DEFAULT_CACHE_DIR } from '../../bench/harness/browser.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATASET_DIR = join(REPO_ROOT, 'e2e', 'datasets', 'cqadupstack-android');
const CORPUS_DIR = join(DATASET_DIR, 'corpus');
const PAGE_ENTRY = 'e2e/harness/page.ts';
// search()'s own default; the aggregate gate is nDCG@10 / Recall@10.
const TOP_K = 10;
// Reported channels beyond the shipped hybrid one, opt-in via E2E_CHANNELS=1.
// α=1 dense-only, α=0 bm25-only (fusion.ts hybrid = α*dense + (1-α)*bm25).
const CHANNEL_DENSE_ONLY = 1;
const CHANNEL_BM25_ONLY = 0;

function fail(msg) { process.stderr.write(`e2e: ${msg}\n`); process.exit(1); }
function log(msg) { process.stderr.write(`e2e: ${msg}\n`); }

// One markdown file per corpus doc; the FakeVault path is the filename so the
// page's noteId (basename without .md) equals the corpus id the qrels use.
function readCorpus() {
    return readdirSync(CORPUS_DIR)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((name) => ({ path: name, content: readFileSync(join(CORPUS_DIR, name), 'utf8') }));
}

function readQueries() {
    const all = JSON.parse(readFileSync(join(DATASET_DIR, 'queries.json'), 'utf8'));
    // The page only needs id + text; `relevant` is the test's business.
    return all.map((q) => ({ id: q.id, text: q.text }));
}

async function main() {
    const device = process.env.E2E_DEVICE || 'wasm';
    const profile = DEVICE_PROFILES[device];
    if (!profile) fail(`E2E_DEVICE=${device} is not one of: ${Object.keys(DEVICE_PROFILES).join(', ')}`);
    const withChannels = process.env.E2E_CHANNELS === '1';
    const port = process.env.BENCH_PORT ? Number(process.env.BENCH_PORT) : DEFAULT_PORT;
    const cacheDir = resolve(REPO_ROOT, process.env.BENCH_CACHE_DIR || DEFAULT_CACHE_DIR);
    const executablePath = resolveChromiumPath();
    const args = chromiumArgs(device);

    const files = readCorpus();
    const queries = readQueries();
    log(`bundling e2e page (${files.length} docs, ${queries.length} queries)`);
    const bundle = await buildBenchBundle(PAGE_ENTRY);

    log(`launching chromium [${executablePath ?? 'playwright-bundled'}] args=[${args.join(' ')}] profile=[${cacheDir}]`);
    await withBrowserPage({ bundle, port, cacheDir, executablePath, args, readyGlobal: '__seekerE2E', log }, async (page, { chromiumVersion }) => {
        const defaultDenseWeight = await page.evaluate(() => window.__seekerE2E.defaultDenseWeight);
        // Default (hybrid) channel first so firstQueryMs measures the hybrid path;
        // extra channels only when asked. De-dupe in case the default is 1 or 0.
        const denseWeights = withChannels
            ? [...new Set([defaultDenseWeight, CHANNEL_DENSE_ONLY, CHANNEL_BM25_ONLY])]
            : [defaultDenseWeight];

        log(`run: device=[${profile.load}] weights=[${denseWeights.join(', ')}] (first-ever run also downloads the model)`);
        const result = await page.evaluate(
            ({ d, files, queries, topK, denseWeights }) => window.__seekerE2E.evalRetrieval(d, files, queries, topK, denseWeights),
            { d: profile.load, files, queries, topK: TOP_K, denseWeights },
        );

        const out = {
            mode: 'e2e',
            device,
            defaultDenseWeight,
            denseWeights,
            topK: TOP_K,
            docs: files.length,
            queryCount: queries.length,
            ...result,
            meta: {
                timestamp: new Date().toISOString(),
                chromium: { executablePath: executablePath ?? 'playwright-bundled', version: chromiumVersion, args },
                cacheDir,
            },
        };
        process.stdout.write(JSON.stringify(out) + '\n');
    });
}

// Guarded (bench/harness/run.mjs pattern) so importers get nothing running.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch((e) => fail(e?.stack ?? String(e)));
}
