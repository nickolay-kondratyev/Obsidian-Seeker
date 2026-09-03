// Shared Chromium page harness: serve an in-memory bundle over http:// and drive
// it in a headless Chromium with a PERSISTENT profile. Extracted from run.mjs
// (ticket nid_tthbuk08rra4lyenl50t6de1c_e) so the indexing bench
// (bench/harness/run.mjs) and the retrieval e2e runner (e2e/harness/run.mjs)
// share ONE launch/serve path and ONE model-cache profile instead of copy-paste.
//
// WHY http:// and not file://: IndexedDB / Cache API / the srcdoc iframe behave
// as in Obsidian only on a real origin. WHY a fixed port + persistent profile:
// those stores are origin-scoped, so a random port would be a cold cache every
// run; the profile holds the ~100 MB model download shared across runs. WHY bench
// and e2e cannot run concurrently: they share this one profile/origin.
import { chromium } from 'playwright-core';
import http from 'node:http';
import { existsSync } from 'node:fs';

// Fixed, not random: Cache API / IndexedDB / localStorage are origin-scoped, so a
// new port would be a new origin and a cold model cache.
export const DEFAULT_PORT = 47331;
// Persistent Chromium profile (repo-relative) holding the HTTP cache + Cache API
// entries transformers.js writes the model into + Dawn's shader cache.
export const DEFAULT_CACHE_DIR = '.bench-cache';
const CONTAINER_CHROMIUM = '/usr/bin/chromium';

// Container Chromium runs as root without a user namespace → needs --no-sandbox;
// /dev/shm is tiny in containers → --disable-dev-shm-usage. Harmless on a host.
export const BASE_CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

// Default: /usr/bin/chromium when present (the container), else undefined →
// Playwright's bundled build (host, installed once by `npm run bench:setup`).
// `BENCH_CHROMIUM` overrides both, and is honoured by the e2e runner too.
export function resolveChromiumPath() {
    if (process.env.BENCH_CHROMIUM) return process.env.BENCH_CHROMIUM;
    return existsSync(CONTAINER_CHROMIUM) ? CONTAINER_CHROMIUM : undefined;
}

// The page: an http:// origin whose only job is to load the bundle, which sets
// its ready global (window.__seekerBench / window.__seekerE2E) once evaluated.
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Seeker harness</title>
<style>.seeker-hidden{display:none}</style></head><body><script src="/app.js"></script></body></html>`;

function serve(bundle, port) {
    const server = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(PAGE_HTML);
        } else if (req.url === '/app.js') {
            res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
            res.end(bundle);
        } else {
            res.writeHead(req.url === '/favicon.ico' ? 204 : 404); res.end();
        }
    });
    return new Promise((resolveP, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolveP(server));
    });
}

// Serve `bundle`, launch a headless Chromium on the persistent `cacheDir` profile,
// open the page, wait until `readyGlobal` (e.g. '__seekerBench') is an object, then
// hand the page to `run(page, { chromiumVersion })`. Tears the server + context
// down afterwards. Returns whatever `run` returns. `log(msg)` gets page
// console errors/warnings and page errors (callers send it to stderr).
export async function withBrowserPage({ bundle, port, cacheDir, executablePath, args, readyGlobal, log }, run) {
    const server = await serve(bundle, port);
    const origin = `http://127.0.0.1:${port}`;
    const context = await chromium.launchPersistentContext(cacheDir, { headless: true, executablePath, args });
    try {
        const page = await context.newPage();
        page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log(`page ${m.type()}: ${m.text()}`); });
        page.on('pageerror', e => log(`page error: ${e.message}`));
        await page.goto(`${origin}/`);
        await page.waitForFunction(g => typeof window[g] === 'object', readyGlobal);
        const chromiumVersion = context.browser()?.version() ?? 'unknown';
        return await run(page, { chromiumVersion });
    } finally {
        await context.close();
        server.close();
    }
}
