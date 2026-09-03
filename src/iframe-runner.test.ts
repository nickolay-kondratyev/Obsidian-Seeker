import { describe, it, expect, vi, afterEach } from 'vitest';
import { IframeRunner, buildChildScript } from './iframe-runner';

// F5 — per-RPC timeout. A jetsam-killed iframe child never replies; without the
// timeout the parent promise hangs forever, stranding the embed catch's
// recycle+retry (search.ts embedOneBatch). We can't build a real srcdoc iframe in
// the node test env, so inject a live-looking iframe whose contentWindow.postMessage
// is a no-op (the child never answers) and drive the timer with fake timers.
afterEach(() => { vi.useRealTimers(); });

function withDeadIframe(): IframeRunner {
    const r = new IframeRunner();
    (r as unknown as { iframe: { contentWindow: { postMessage: () => void } } }).iframe = {
        contentWindow: { postMessage: () => { /* child never replies */ } },
    };
    return r;
}

describe('IframeRunner per-RPC timeout (F5)', () => {
    it('rejects a never-answered embedBatch with a recoverable TIMEOUT error', async () => {
        vi.useFakeTimers();
        const r = withDeadIframe();
        const p = r.embedBatch(['hello']);
        // tagged TIMEOUT (not DISPOSED) so the embed catch recycles+retries.
        const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(60_001);   // RPC_TIMEOUT_MS + 1
        await assertion;
    });

    it('a load RPC uses the longer ceiling (still pending past the embed timeout)', async () => {
        vi.useFakeTimers();
        const r = withDeadIframe();
        const p = r.load({ modelId: 'some/repo', device: 'wasm', dtype: 'q4', skipWarmup: true, warmupGrid: [], pooling: 'cls', outputDim: 384 });
        let settled = false;
        p.then(() => { settled = true; }, () => { settled = true; });
        await vi.advanceTimersByTimeAsync(60_001);   // past the 60s embed ceiling
        expect(settled).toBe(false);                 // load gets LOAD_RPC_TIMEOUT_MS (180s), not 60s
        const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(120_001);   // total > 180s
        await assertion;
    });

    it('an uninitialized runner rejects immediately, not via the timeout', async () => {
        const r = new IframeRunner();   // no iframe injected
        await expect(r.embedBatch(['x'])).rejects.toThrow(/not initialized/);
    });
});

// Iframe child's RPC dispatch runs inside a srcdoc'd module script, which we
// can't execute in the node test env — so assert on the emitted source text
// that the child rejects postMessage events not sourced from window.parent
// before it ever reaches the RPC dispatcher (mirrors the parent-side
// `event.source !== this.iframe.contentWindow` guard in buildIframe()).
describe('iframe child message handler — source check', () => {
    it('gates RPC dispatch on event.source === window.parent', () => {
        const script = buildChildScript('https://example.com/cdn');
        const handlerStart = script.indexOf("addEventListener('message', async (event)");
        expect(handlerStart).toBeGreaterThan(-1);
        const guardIdx = script.indexOf('event.source !== window.parent', handlerStart);
        const dispatchIdx = script.indexOf("data.type === 'load'", handlerStart);
        expect(guardIdx).toBeGreaterThan(handlerStart);
        expect(guardIdx).toBeLessThan(dispatchIdx);
    });
});

// tx.js pins non-WebKit engines to the asyncify ORT build for EVERY device,
// but that build has no CPU GatherBlockQuantized kernel — a device:'wasm'
// session can never load the shipped GBQ4 model on it (the r/ObsidianMD
// desktop failure; also all of Android). The child must rewrite the asyncify
// pin back to the plain build on BOTH wasm attempts (initial + SIMD retry).
describe('iframe child WASM path — plain-glue pin (CPU GBQ kernel)', () => {
    it('emits the asyncify→plain wasmPaths rewrite and applies it on the wasm path', () => {
        const script = buildChildScript('https://example.com/cdn');
        // The override rewrites BOTH the .mjs glue and the .wasm binary.
        expect(script).toContain("'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.mjs'");
        expect(script).toContain("'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.wasm'");
        // Applied on the wasm fallback: initial attempt + the 'no available
        // backend' SIMD retry each get a fresh module instance, so each must
        // re-apply the override. Match the call-site text (assignment form),
        // not the bare identifier — indexOf on the identifier alone would
        // count the function DECLARATION as the first hit and pass even if
        // the retry-path re-application were deleted.
        const first = script.indexOf('wasmGlue = overrideGlueForWasm(env)');
        const second = script.indexOf('wasmGlue = overrideGlueForWasm(env)', first + 1);
        expect(first).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(first);
    });

    it('no-ops when wasmPaths is not the asyncify pin (WebKit plain path)', () => {
        const script = buildChildScript('https://example.com/cdn');
        const fnStart = script.indexOf('function overrideGlueForWasm');
        expect(fnStart).toBeGreaterThan(-1);
        const guardIdx = script.indexOf("includes('ort-wasm-simd-threaded.asyncify.mjs')", fnStart);
        const rewriteIdx = script.indexOf('wp.mjs = ', fnStart);
        expect(guardIdx).toBeGreaterThan(fnStart);
        expect(guardIdx).toBeLessThan(rewriteIdx);
    });
});

// When 'auto' falls through to WASM and WASM ALSO fails, the child must not
// throw only the terminal wasm error — that discards webgpuError before
// loadModel can return a LoadResult, so the diagnostic report shows the wasm
// session error but never WHY WebGPU fell back (the blind spot in the
// r/ObsidianMD report). Assert the emitted child preserves both causes, on
// both wasm attempts.
describe('iframe child WASM fallback — preserves the WebGPU failure cause', () => {
    it('re-throws with both webgpu and wasm error context when webgpu was attempted', () => {
        const script = buildChildScript('https://example.com/cdn');
        // The combined throw fires only when a WebGPU attempt recorded an error.
        expect(script).toContain('webgpuAttempted && webgpuError');
        expect(script).toContain('model load failed on both paths');
        expect(script).toMatch(/webgpu: '\s*\+\s*webgpuError/);
        // Both the initial wasm attempt and the SIMD retry route their
        // failures through the combining helper.
        const first = script.indexOf('wasmFail(e)');
        const second = script.indexOf('wasmFail(e2)');
        expect(first).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(first);
    });
});

describe('iframe child WebGPU path — software adapter rejection (lever 0a)', () => {
    it('inlines classifyAdapter as evaluable, self-contained source', () => {
        const script = buildChildScript('https://example.com/cdn');
        const m = script.match(/const classifyAdapter = (function[\s\S]*?\n});/);
        expect(m).not.toBeNull();
        // Evaluate exactly the text the child sees: no module scope, no imports.
        const fn = new Function('return ' + m![1])() as (i: unknown) => string;
        expect(fn({ present: true, vendor: 'google', description: '' })).toBe('software');
    });
    it('rejects a software adapter BEFORE tryWebgpu and records the reason', () => {
        const script = buildChildScript('https://example.com/cdn');
        const gate = script.indexOf("adapterSummary.classification === 'software'");
        const reject = script.indexOf("'webgpu-fallback-rejected: '");
        const attempt = script.indexOf('await tryWebgpu(');
        expect(gate).toBeGreaterThan(-1);
        expect(reject).toBeGreaterThan(gate);
        expect(attempt).toBeGreaterThan(reject);
    });
    it('runs the post-warmup probe after the warmup block and ships adapter + probe on every return', () => {
        const script = buildChildScript('https://example.com/cdn');
        expect(script.indexOf('await probeForwardMs()')).toBeGreaterThan(script.indexOf('warmupMs = performance.now() - warmupStart'));
        expect(script.match(/adapter: adapterSummary, webgpuProbeMs/g)?.length).toBe(3);
    });
});

// Lever 1 (nid_0yhtxzgrmly7zk6m6quiqfpil_e): the warmup grid is no longer a
// build-time constant — the parent derives it per platform (warmupGridFor) and
// the child loops over the load payload's per-bucket cells.
describe('iframe child warmup — per-bucket grid from the load payload', () => {
    it('loops 1..cell.maxBatch over the injected warmupGrid and no flat batch list survives', () => {
        const script = buildChildScript('https://example.com/cdn');
        expect(script).toContain('data.payload.warmupGrid');
        expect(script).toContain('for (const cell of warmupGrid)');
        expect(script).toContain('for (let n = 1; n <= cell.maxBatch; n++)');
        expect(script).not.toContain('WARMUP_BATCH_SIZES');
    });
});

// Model 3/6 (nid_89jwpyh0t0j1cncxsn5u2n2ih_e): pooling + output dim are per-load
// payload state, not build-time template constants — the script is built once
// per iframe and a runner is loaded again (possibly with another model) after
// recycle(). The child measures the real width right after pipeline creation on
// BOTH device paths and every forward pass shares one option builder.
describe('iframe child model identity — per-load pooling + detected output dim', () => {
    const script = buildChildScript('https://example.com/cdn');
    it('no longer templates OUTPUT_DIM into the child', () => {
        expect(script).not.toContain('OUTPUT_DIM =');
    });
    it('every forward pass reads the per-load pooling through embedOpts (no hardcoded cls)', () => {
        expect(script.match(/pooling: pooling/g)?.length).toBe(1);
        expect(script).not.toContain("pooling: 'cls'");
    });
    it('resets pooling + outputDim from the load payload at the top of loadModel', () => {
        const loadStart = script.indexOf('async function loadModel(');
        const reset = script.indexOf('pooling = requestedPooling;', loadStart);
        const firstPipeline = script.indexOf('await tryWebgpu(', loadStart);
        expect(reset).toBeGreaterThan(loadStart);
        expect(reset).toBeLessThan(firstPipeline);
        expect(script.indexOf('outputDim = null;', loadStart)).toBeLessThan(firstPipeline);
        expect(script).toContain('data.payload.pooling');
        expect(script).toContain('data.payload.outputDim');
    });
    it('runs detectOutputDim on the webgpu path BEFORE warmup and on every wasm path', () => {
        const calls = script.match(/await detectOutputDim\(requestedOutputDim\)/g) ?? [];
        expect(calls.length).toBeGreaterThanOrEqual(3);
        const webgpuDetect = script.indexOf('await detectOutputDim(requestedOutputDim)', script.indexOf('await tryWebgpu('));
        expect(webgpuDetect).toBeLessThan(script.indexOf('for (const cell of warmupGrid)'));
        // proxy-worker wasm path and the plain/SIMD-retry wasm path each detect.
        const proxy = script.indexOf('env.backends.onnx.wasm.proxy = true;');
        expect(script.indexOf('await detectOutputDim(requestedOutputDim)', proxy)).toBeGreaterThan(proxy);
        const simdRetry = script.indexOf('wasmFail(e2)');
        expect(script.indexOf('await detectOutputDim(requestedOutputDim)', simdRetry)).toBeGreaterThan(simdRetry);
    });
    it('embed guards are equality checks against the measured outputDim', () => {
        expect(script).toContain('if (outDim !== outputDim) throw');
        expect(script).toContain('if (dim !== outputDim) throw');
        expect(script).not.toMatch(/< OUTPUT_DIM/);
    });
    it('ships the measured dim on every LoadResult return', () => {
        expect(script.match(/dim: outputDim,/g)?.length).toBe(3);
    });
    it('detectOutputDim fails loud with a plain-language width mismatch', () => {
        expect(script).toContain("'model produced ' + measured + '-d vectors, expected ' + requested + '-d'");
    });
});
