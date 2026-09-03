// Builds a browser page bundle (a page entry + the real plugin modules) in
// memory. Mirrors the production esbuild.config.mjs where it matters for the
// measured path (same target/platform, same build-time defines) and the vitest
// config where the bench is a test host (the `obsidian` types-only package is
// aliased to the vitest runtime stub). Imported by run.mjs (default entry, the
// bench page) and by e2e/harness/run.mjs (entry 'e2e/harness/page.ts', the
// retrieval page) so both bundle through the same defines/alias; not a CLI.
import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function buildBenchBundle(entryPoint = 'bench/harness/page.ts') {
    const pluginVersion = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')).version;
    const result = await esbuild.build({
        absWorkingDir: REPO_ROOT,
        entryPoints: [entryPoint],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        platform: 'browser',
        write: false,
        sourcemap: 'inline',
        logLevel: 'silent',
        alias: { obsidian: './src/test-stubs/obsidian.ts' },
        define: {
            'process.env.NODE_ENV': JSON.stringify('development'),
            '__BUILD_TS__': JSON.stringify(new Date().toISOString()),
            '__PLUGIN_VERSION__': JSON.stringify(`${pluginVersion}-bench`),
            // The BM25 analyzer hash only gates persisted-index reuse; every bench
            // run starts from a fresh DB, so the 'dev' fallback is equivalent.
            '__SEEKER_ANALYZER_VERSION__': JSON.stringify('bench'),
            // Empty → BinaryScorerWorker stays inert (query-side only; a full
            // reindex never dispatches to it). Same as under vitest.
            '__BINARY_WORKER_SRC__': JSON.stringify(''),
        },
    });
    return result.outputFiles[0].text;
}
