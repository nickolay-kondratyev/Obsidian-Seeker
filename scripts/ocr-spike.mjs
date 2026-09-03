#!/usr/bin/env node
// Phase-0 OCR spike — tesseract.js 7 bench (ticket nid_cuu1jus7e29gcqcp7xycfxhz1_e,
// plan docs/research/image-ocr.md §10 Phase 0). Bench-first, BEFORE any plugin
// code; follows the shape of scripts/bench.mjs + bench/harness/run.mjs (Playwright
// Chromium, network to the CDN, results as NDJSON).
//
//   node scripts/ocr-fixtures.mjs   # first: (re)generate .out/ocr-fixtures/
//   node scripts/ocr-spike.mjs      # then:  OCR every fixture, write §13 numbers
//
// What it proves / measures (the ticket's deliverable 2):
//   - tesseract.js 7.0.0 loads from jsdelivr INSIDE a srcdoc iframe with NO
//     `sandbox` attribute (mirrors the LOAD-BEARING comment in
//     src/iframe-runner.ts: a sandboxed iframe gets an opaque origin and loses
//     the Cache API). Explicit workerPath / corePath / langPath. This exercises
//     the Blob worker + remote importScripts + wasm load the OCR iframe needs.
//   - the child receives the image as a TRANSFERRED ArrayBuffer and decodes it
//     with createImageBitmap, resizing during decode (the §5 shape).
//   - per fixture at 1×/2×/3× upscale: ms/image, word accuracy vs the exact
//     ground truth, per-word confidence distribution.
//   - heap: main-isolate JSHeapUsedSize (CDP Performance.getMetrics) before/after
//     the OCR run and after worker terminate (the §8a "heap never shrinks" +
//     teardown story — see the CAVEAT the summary prints and §13 records).
//   - a second language pack (deu) loaded alongside eng: load time + ms/image
//     delta (§9 Q5 makes the language multi-select a V1 feature).
//
// Output: NDJSON per (engine, fixture, scale) to .out/ocr-spike/results.ndjson
// (git-ignored), plus a human summary on stdout. The §13 doc section is written
// from that summary. Keep this script — it is the harness the PP-OCR follow-up
// (nid_ybv5cljnxx9wb4ha2gbvpsbmd_e) re-runs.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveChromiumPath, BASE_CHROMIUM_ARGS, withBrowserPage } from '../bench/harness/browser.mjs';
import { DEFAULT_FIXTURES_DIR, normalizeText } from './ocr-fixtures.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = resolve(REPO_ROOT, process.env.OCR_SPIKE_DIR || '.out/ocr-spike');
const RESULTS_FILE = join(OUT_DIR, 'results.ndjson');
// Own origin + persistent profile, SEPARATE from the bench's .bench-cache so the
// two can run independently. Holds the jsdelivr HTTP cache + tesseract's Cache
// API entries (core wasm, worker, lang data) so only the first run downloads.
const CACHE_DIR = resolve(REPO_ROOT, process.env.OCR_SPIKE_CACHE_DIR || '.tmp/ocr-spike-cache');
const PORT = process.env.OCR_SPIKE_PORT ? Number(process.env.OCR_SPIKE_PORT) : 47332;
const SCALES = [1, 2, 3];
// §5/§12 D4: reject above a pixel cap (Text Extractor #34 crashed on 139 MP).
// Measured in device pixels of the UPSCALED image the engine actually decodes.
const PIXEL_CAP = 25_000_000;

// ── CDN endpoints (all proven reachable; see the ticket) ─────────────────────
const TESS_VERSION = '7.0.0';
const CDN = {
    esm: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/tesseract.esm.min.js`,
    worker: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/worker.min.js`,
    // A DIRECTORY: tesseract picks tesseract-core-simd.wasm.js via wasm-feature-detect.
    core: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESS_VERSION}/`,
    // tesseract.js default; serves <lang>.traineddata.gz.
    lang: 'https://tessdata.projectnaptha.com/4.0.0',
};

function log(msg) { process.stderr.write(`ocr-spike: ${msg}\n`); }

// ── accuracy math (pure, unit-independent) ───────────────────────────────────
// Word stream: lowercase, non-alphanumeric → space, split. So "Math.max(w," and
// "math max w" compare word-for-word without punctuation noise dominating.
export function words(s) {
    return normalizeText(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

// Levenshtein edit distance over two word arrays (the WER numerator).
export function wordEditDistance(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    let curr = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

// Word accuracy = 1 - WER, clamped. WER = edits / |ground truth|, so it penalises
// BOTH dropped words and inserted UI-noise words (the §6 ranking-pollution risk).
export function wordAccuracy(gt, ocr) {
    const g = words(gt), o = words(ocr);
    if (g.length === 0) return o.length === 0 ? 1 : 0;
    return Math.max(0, 1 - wordEditDistance(g, o) / g.length);
}

// ── distribution stats over a numeric array ──────────────────────────────────
export function stats(xs) {
    if (xs.length === 0) return { n: 0, min: null, p1: null, p5: null, p10: null, p25: null, median: null, mean: null, max: null };
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return {
        n: s.length, min: round(s[0]), p1: round(q(0.01)), p5: round(q(0.05)), p10: round(q(0.10)), p25: round(q(0.25)),
        median: round(q(0.5)), mean: round(mean), max: round(s[s.length - 1]),
    };
}
function round(x) { return x == null ? null : Math.round(x * 100) / 100; }

// ── the child script that runs INSIDE the srcdoc iframe ──────────────────────
// Lives in a template literal → NO backticks and NO ${...} inside (single-quote
// concatenation only), exactly the discipline src/iframe-runner.ts uses for its
// child body. It imports tesseract.js from the CDN, owns the worker, decodes the
// transferred ArrayBuffer with createImageBitmap, and answers postMessage RPCs.
function buildChildScript() {
    return ''
        + 'const CDN = ' + JSON.stringify(CDN) + ';\n'
        + 'const PIXEL_CAP = ' + PIXEL_CAP + ';\n'
        + 'let createWorker = null;\n'
        + 'let worker = null;\n'
        + 'async function loadWorker(langs) {\n'
        + '  const t0 = performance.now();\n'
        + '  if (!createWorker) { const mod = await import(CDN.esm); createWorker = (mod.default || mod).createWorker; }\n'
        + '  worker = await createWorker(langs, 1, {\n'
        + '    workerPath: CDN.worker, corePath: CDN.core, langPath: CDN.lang,\n'
        + '    workerBlobURL: true, gzip: true,\n'
        + '  });\n'
        + '  return { loadMs: performance.now() - t0, langs: langs };\n'
        + '}\n'
        + 'async function recognize(buf, scale) {\n'
        + '  const t0 = performance.now();\n'
        + '  const blob = new Blob([buf]);\n'
        + '  const natural = await createImageBitmap(blob);\n'
        + '  const w0 = natural.width, h0 = natural.height;\n'
        + '  const tw = Math.round(w0 * scale), th = Math.round(h0 * scale);\n'
        + '  if (tw * th > PIXEL_CAP) { natural.close(); return { capped: true, w0: w0, h0: h0, tw: tw, th: th }; }\n'
        + '  const decodeStart = performance.now();\n'
        + '  const scaled = scale === 1 ? natural : await createImageBitmap(natural, { resizeWidth: tw, resizeHeight: th, resizeQuality: "high" });\n'
        + '  if (scaled !== natural) natural.close();\n'
        + '  const canvas = new OffscreenCanvas(tw, th);\n'
        + '  const ctx = canvas.getContext("2d");\n'
        + '  ctx.drawImage(scaled, 0, 0);\n'
        + '  scaled.close();\n'
        + '  const decodeMs = performance.now() - decodeStart;\n'
        + '  const ocrStart = performance.now();\n'
        + '  const res = await worker.recognize(canvas, {}, { text: true, blocks: true });\n'
        + '  const ocrMs = performance.now() - ocrStart;\n'
        + '  const data = res.data;\n'
        + '  const wordsOut = [];\n'
        + '  const blocks = data.blocks || [];\n'
        + '  for (const b of blocks) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) for (const wd of (l.words || [])) {\n'
        + '    wordsOut.push({ text: wd.text, conf: wd.confidence });\n'
        + '  }\n'
        + '  return { text: data.text || "", meanConf: data.confidence, words: wordsOut,\n'
        + '           w0: w0, h0: h0, tw: tw, th: th, decodeMs: decodeMs, ocrMs: ocrMs, totalMs: performance.now() - t0 };\n'
        + '}\n'
        + 'async function terminate() { if (worker) { await worker.terminate(); worker = null; } return { ok: true }; }\n'
        + 'window.addEventListener("message", async (event) => {\n'
        + '  if (event.source !== window.parent) return;\n'
        + '  const d = event.data; if (!d || typeof d !== "object" || !d.id || !d.type) return;\n'
        + '  try {\n'
        + '    let result;\n'
        + '    if (d.type === "load") result = await loadWorker(d.payload.langs);\n'
        + '    else if (d.type === "recognize") result = await recognize(d.payload.buf, d.payload.scale);\n'
        + '    else if (d.type === "terminate") result = await terminate();\n'
        + '    else throw new Error("unknown type: " + d.type);\n'
        + '    window.parent.postMessage({ id: d.id, ok: true, result: result }, "*");\n'
        + '  } catch (e) {\n'
        + '    window.parent.postMessage({ id: d.id, ok: false, error: String(e), stack: e && e.stack ? e.stack : null }, "*");\n'
        + '  }\n'
        + '});\n'
        + 'try { window.parent.postMessage({ id: "__ready" }, "*"); }\n'
        + 'catch (e) { window.parent.postMessage({ id: "__error", error: String(e) }, "*"); }\n';
}

// ── the page bundle served at /app.js: builds the iframe + drives RPC ─────────
// Also a template literal; the child script text is injected via JSON.stringify.
// window.__seekerOcr exposes async build/load/recognize/terminate that node
// drives with page.evaluate (image bytes cross as base64 strings, then the page
// TRANSFERS the decoded ArrayBuffer into the child — the §5 zero-copy hop).
function buildPageBundle() {
    const childScript = buildChildScript();
    return `
const CHILD_SCRIPT = ${JSON.stringify(childScript)};
class OcrHarness {
    constructor() { this.iframe = null; this.pending = new Map(); this.listener = null; }
    build() {
        return new Promise((resolveP, reject) => {
            const timeout = setTimeout(() => reject(new Error('iframe ready timeout')), 30000);
            this.listener = (event) => {
                if (!this.iframe || event.source !== this.iframe.contentWindow) return;
                const data = event.data; if (!data || typeof data !== 'object') return;
                if (data.id === '__ready') { clearTimeout(timeout); resolveP(); return; }
                if (data.id === '__error') { clearTimeout(timeout); reject(new Error('child bootstrap failed: ' + data.error)); return; }
                const p = this.pending.get(data.id); if (!p) return;
                this.pending.delete(data.id);
                if (data.ok) p.resolve(data.result); else p.reject(new Error(data.error || 'child error'));
            };
            window.addEventListener('message', this.listener);
            // LOAD-BEARING: NO sandbox attribute. A srcdoc iframe with no sandbox
            // inherits the real page origin, keeping the Cache API + cross-origin
            // fetches the CDN load needs (mirror of src/iframe-runner.ts).
            this.iframe = document.createElement('iframe');
            this.iframe.style.display = 'none';
            document.body.appendChild(this.iframe);
            this.iframe.srcdoc = '<!DOCTYPE html><html><body><script type="module">' + CHILD_SCRIPT + '<\\/script></body></html>';
        });
    }
    send(type, payload, transfer) {
        return new Promise((resolveP, reject) => {
            const id = crypto.randomUUID();
            this.pending.set(id, { resolve: resolveP, reject });
            this.iframe.contentWindow.postMessage({ id, type, payload }, '*', transfer || []);
        });
    }
    load(langs) { return this.send('load', { langs }); }
    async recognize(b64, scale) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // Transfer the ArrayBuffer (zero-copy) into the child — the §5 hop.
        return this.send('recognize', { buf: bytes.buffer, scale }, [bytes.buffer]);
    }
    terminate() { return this.send('terminate', {}); }
    workerCount() { return 0; }
    teardown() {
        if (this.iframe && this.iframe.parentNode) this.iframe.parentNode.removeChild(this.iframe);
        this.iframe = null;
        if (this.listener) { window.removeEventListener('message', this.listener); this.listener = null; }
    }
}
window.__seekerOcr = new OcrHarness();
`;
}

// ── fixtures ─────────────────────────────────────────────────────────────────
function readFixtures(fixturesDir) {
    const indexPath = join(fixturesDir, 'index.json');
    if (!existsSync(indexPath)) {
        throw new Error(`no fixtures at ${indexPath} — run 'node scripts/ocr-fixtures.mjs' first`);
    }
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    return index.map((f) => ({ ...f, b64: readFileSync(join(fixturesDir, f.file)).toString('base64') }));
}

// ── heap via CDP (ticket's literal ask: Performance.getMetrics JSHeapUsedSize) ─
async function jsHeap(client) {
    const { metrics } = await client.send('Performance.getMetrics');
    const m = metrics.find((x) => x.name === 'JSHeapUsedSize');
    return m ? m.value : null;
}
const MB = (bytes) => (bytes == null ? null : Math.round((bytes / (1024 * 1024)) * 10) / 10);

// ── one engine run: build iframe, load worker, OCR the corpus, tear down ─────
// `scales`: which upscales to run per fixture. Records one NDJSON line per
// (engine, fixture, scale) and returns the per-engine aggregate incl. heap.
async function runEngine({ page, client, langs, fixtures, scales, label, session }) {
    log(`── engine [${label}] langs=[${langs.join('+')}] ──`);
    const heapBaseline = await jsHeap(client);
    await page.evaluate(() => window.__seekerOcr.build());
    const load = await page.evaluate((l) => window.__seekerOcr.load(l), langs);
    const heapAfterLoad = await jsHeap(client);
    log(`loaded in ${Math.round(load.loadMs)} ms; heap ${MB(heapBaseline)}→${MB(heapAfterLoad)} MB`);

    const rows = [];
    const perWordClean = [];      // per-word confidences from perfectly-OCR'd images
    const perWordDegraded = [];   // per-word confidences from images with any error
    for (const f of fixtures) {
        for (const scale of scales) {
            const r = await page.evaluate(({ b64, scale }) => window.__seekerOcr.recognize(b64, scale), { b64: f.b64, scale });
            if (r.capped) {
                log(`  ${f.id} @${scale}x CAPPED (${r.tw}×${r.th} > ${PIXEL_CAP})`);
                rows.push({ id: f.id, kind: f.kind, scale, capped: true, tw: r.tw, th: r.th });
                continue;
            }
            const acc = wordAccuracy(f.gt, r.text);
            const confs = r.words.map((w) => w.conf);
            const row = {
                id: f.id, kind: f.kind, fontPx: f.fontPx, theme: f.theme, dpr: f.dpr,
                format: f.format, blur: f.blur, scale,
                w0: r.w0, h0: r.h0, tw: r.tw, th: r.th,
                accuracy: round(acc), meanConf: round(r.meanConf),
                gtWords: words(f.gt).length, ocrWords: words(r.text).length,
                ocrChars: normalizeText(r.text).length,
                wordConf: stats(confs), decodeMs: round(r.decodeMs), ocrMs: round(r.ocrMs), totalMs: round(r.totalMs),
            };
            // Aggregate per-word confidence, split by whether the WHOLE image
            // OCR'd perfectly — the §6 per-word-floor question is "how low does a
            // REAL word score (clean) vs a word from a degraded/misread image".
            for (const c of confs) (acc === 1 ? perWordClean : perWordDegraded).push(c);
            rows.push(row);
            appendResult({ ...session, engine: label, ...row });
            log(`  ${f.id} @${scale}x acc=${(acc * 100).toFixed(0)}% conf=${round(r.meanConf)} ocr=${Math.round(r.ocrMs)}ms words=${row.ocrWords}/${row.gtWords}`);
        }
    }

    const heapAfterOcr = await jsHeap(client);
    await page.evaluate(() => window.__seekerOcr.terminate());
    const heapAfterTerminate = await jsHeap(client);
    await page.evaluate(() => window.__seekerOcr.teardown());
    const heapAfterTeardown = await jsHeap(client);
    const heap = {
        baselineMB: MB(heapBaseline), afterLoadMB: MB(heapAfterLoad), afterOcrMB: MB(heapAfterOcr),
        afterTerminateMB: MB(heapAfterTerminate), afterTeardownMB: MB(heapAfterTeardown),
    };
    log(`heap MB: baseline=${heap.baselineMB} load=${heap.afterLoadMB} ocr=${heap.afterOcrMB} terminate=${heap.afterTerminateMB} teardown=${heap.afterTeardownMB}`);
    return {
        label, langs, loadMs: round(load.loadMs), heap,
        rows: rows.filter((r) => !r.capped), capped: rows.filter((r) => r.capped),
        perWordConf: { clean: stats(perWordClean), degraded: stats(perWordDegraded) },
    };
}

function appendResult(line) {
    mkdirSync(OUT_DIR, { recursive: true });
    appendFileSync(RESULTS_FILE, JSON.stringify(line) + '\n');
}

// ── summary shaping (what §13 is written from) ───────────────────────────────
function byScale(rows) {
    const out = {};
    for (const scale of SCALES) {
        const rs = rows.filter((r) => r.scale === scale);
        if (rs.length === 0) continue;
        out[scale] = {
            n: rs.length,
            accuracy: stats(rs.map((r) => r.accuracy)),
            ocrMs: stats(rs.map((r) => r.ocrMs)),
            meanConf: stats(rs.map((r) => r.meanConf)),
            ocrChars: stats(rs.map((r) => r.ocrChars)),
        };
    }
    return out;
}

function summarize(eng, deu) {
    return {
        eng: {
            loadMs: eng.loadMs, heap: eng.heap, byScale: byScale(eng.rows), byKind: byKind(eng.rows),
            perWordConf: eng.perWordConf,
            // Images that did NOT OCR perfectly, at each scale — the anchor for the
            // whole-image min-mean-confidence gate (does a bad image score low?).
            degraded: eng.rows.filter((r) => r.accuracy < 1)
                .map((r) => ({ id: r.id, scale: r.scale, accuracy: r.accuracy, meanConf: r.meanConf, ocrChars: r.ocrChars, wordConfMin: r.wordConf.min }))
                .sort((a, b) => a.accuracy - b.accuracy),
        },
        deu: deu ? { loadMs: deu.loadMs, heap: deu.heap, byScale: byScale(deu.rows) } : null,
        // eng+deu vs eng at the SAME scale, on the SAME fixture subset deu ran.
        langDelta: deu ? langDelta(eng.rows, deu.rows) : null,
    };
}

function byKind(rows) {
    const kinds = [...new Set(rows.map((r) => r.kind))];
    const out = {};
    for (const k of kinds) {
        const rs = rows.filter((r) => r.kind === k);
        out[k] = { n: rs.length, accuracy: stats(rs.map((r) => r.accuracy)), meanConf: stats(rs.map((r) => r.meanConf)) };
    }
    return out;
}

function langDelta(engRows, deuRows) {
    const key = (r) => r.id + '@' + r.scale;
    const engMap = new Map(engRows.map((r) => [key(r), r]));
    const pairs = deuRows.map((d) => ({ d, e: engMap.get(key(d)) })).filter((p) => p.e);
    if (pairs.length === 0) return null;
    return {
        n: pairs.length,
        ocrMsDelta: stats(pairs.map((p) => p.d.ocrMs - p.e.ocrMs)),
        accuracyDelta: stats(pairs.map((p) => p.d.accuracy - p.e.accuracy)),
    };
}

async function main() {
    const fixturesDir = resolve(REPO_ROOT, process.env.OCR_FIXTURES_DIR || DEFAULT_FIXTURES_DIR);
    const fixtures = readFixtures(fixturesDir);
    const executablePath = resolveChromiumPath();
    const args = BASE_CHROMIUM_ARGS;
    rmSync(RESULTS_FILE, { force: true });
    mkdirSync(OUT_DIR, { recursive: true });

    const session = { date: new Date().toISOString(), tesseract: TESS_VERSION, fixtures: fixtures.length };
    log(`chromium=[${executablePath ?? 'playwright-bundled'}] fixtures=[${fixtures.length}] scales=[${SCALES.join(',')}]`);
    log(`profile=[${CACHE_DIR}] (first run downloads core wasm + lang data from the CDN)`);

    const bundle = buildPageBundle();
    // The deu language sweep runs on a representative SUBSET at scale 2 only
    // (§9 Q5 needs the load-time + ms/image delta, not the full matrix twice).
    const deuFixtures = fixtures.filter((f) => ['prose', 'chat'].includes(f.kind));

    let summary;
    await withBrowserPage(
        { bundle, port: PORT, cacheDir: CACHE_DIR, executablePath, args, readyGlobal: '__seekerOcr', log },
        async (page, { chromiumVersion }) => {
            const client = await page.context().newCDPSession(page);
            await client.send('Performance.enable');
            session.chromium = chromiumVersion;

            const eng = await runEngine({ page, client, langs: ['eng'], fixtures, scales: SCALES, label: 'eng', session });
            const deu = await runEngine({ page, client, langs: ['eng', 'deu'], fixtures: deuFixtures, scales: [2], label: 'eng+deu', session });

            summary = { ...session, chromium: chromiumVersion, ...summarize(eng, deu) };
        },
    );

    writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    log(`\nCAVEAT (heap): JSHeapUsedSize is the iframe/page MAIN-isolate heap only.`);
    log(`tesseract's ~160 MB wasm heap lives in the Blob WORKER thread, which this`);
    log(`metric does not include — the decisive, observable fact is that`);
    log(`worker.terminate() releases the worker (thread + its WebAssembly.Memory)`);
    log(`entirely, which is why the design tears the OCR iframe down after a drain.`);
    log(`\nresults: ${RESULTS_FILE}\nsummary: ${join(OUT_DIR, 'summary.json')}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch((e) => { log(e?.stack ?? String(e)); process.exit(1); });
}
