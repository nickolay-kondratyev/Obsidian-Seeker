import esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const prod = process.argv[2] === 'production';

// Build timestamp for the diagnostic report's per-init stamp (iframe-runner.ts
// __BUILD_TS__ → InitEntry.buildTimestamp). This MUST be deterministic: a
// wall-clock `new Date()` made every rebuild of the same commit produce a
// different main.js, so the published release asset could never be reproduced
// from source — which is exactly what Obsidian's release check flags ("build
// output does not match the released main.js artifact"). Derive it from the
// committed source instead so CI and anyone rebuilding the same commit emit
// byte-identical bundles:
//   1. SOURCE_DATE_EPOCH — the reproducible-builds standard; honored first so a
//      build can be pinned explicitly.
//   2. HEAD commit's committer date — fixed in the commit object, so it is the
//      same in the CI release build and in any clone that reproduces it.
//   3. 'unknown' — only when there is no git and no override (e.g. a source
//      tarball); a stable sentinel, never the wall clock, so determinism holds.
// Normalized to a UTC "Z" instant so the local timezone never leaks in.
function resolveBuildTimestamp() {
    const epoch = process.env.SOURCE_DATE_EPOCH;
    if (epoch && /^\d+$/.test(epoch)) {
        return new Date(Number(epoch) * 1000).toISOString();
    }
    try {
        const iso = execFileSync('git', ['log', '-1', '--format=%cI'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (iso) return new Date(iso).toISOString();
    } catch {
        // No git or not a repo — fall through to the stable sentinel.
    }
    return 'unknown';
}
const buildTimestamp = resolveBuildTimestamp();

// Plugin version for the diagnostic report's per-init stamp (embedder.ts
// PLUGIN_VERSION → InitEntry.pluginVersion). manifest.json is the version
// source of truth (the promote/release flow rewrites it), so read it here —
// the previous hand-maintained constant went stale and shipped 1.0.x public
// builds stamped every report "v0.0.1".
const pluginVersion = JSON.parse(readFileSync('manifest.json', 'utf8')).version;

// Content hash of the BM25 analyzer sources + the MiniSearch version. Any edit
// to tokenization / term processing / depluralize tables / field derivation —
// or a MiniSearch upgrade — changes which tokens land in the persisted index's
// postings, so this hash gates the persisted-index stamp (search.ts /
// bm25.ts ANALYZER_VERSION): a changed analyzer auto-invalidates old blobs and
// forces a refit, keeping a loaded index relevance-identical to a fresh fit.
const analyzerVersion = createHash('sha256')
    .update(readFileSync('src/bm25.ts'))
    .update(readFileSync('src/tokenize.ts'))
    .update(readFileSync('src/prop-normalize.ts'))
    .update(JSON.parse(readFileSync('node_modules/minisearch/package.json', 'utf8')).version)
    .digest('hex')
    .slice(0, 16);

// Bundle the off-thread binary scorer to a standalone IIFE string, injected into
// the main bundle via `define` (__BINARY_WORKER_SRC__). The main thread spins it
// up from a Blob URL — Obsidian plugins ship a single main.js with no sidecar
// file to load, so the worker source rides inline. It pulls in only the pure
// compute (binary.ts + select.ts), so it stays tiny and obsidian-free.
const workerBuild = await esbuild.build({
    entryPoints: ['src/binary-worker.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    write: false,
    minify: prod,
    sourcemap: false,
    logLevel: 'silent',
});
const binaryWorkerSrc = workerBuild.outputFiles[0].text;

const context = await esbuild.context({
    entryPoints: ['src/main.ts'],
    bundle: true,
    external: ['obsidian', 'electron', 'node:*'],
    format: 'cjs',
    target: 'es2022',
    platform: 'browser',
    outfile: 'main.js',
    minify: prod,
    sourcemap: prod ? false : 'inline',
    logLevel: 'info',
    define: {
        'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
        '__BUILD_TS__': JSON.stringify(buildTimestamp),
        '__PLUGIN_VERSION__': JSON.stringify(pluginVersion),
        '__SEEKER_ANALYZER_VERSION__': JSON.stringify(analyzerVersion),
        '__BINARY_WORKER_SRC__': JSON.stringify(binaryWorkerSrc),
    },
});

if (prod) {
    await context.rebuild();
    await context.dispose();
    console.log('Seeker: production build complete');
} else {
    await context.watch();
    console.log('Seeker: dev build in watch mode');
}
