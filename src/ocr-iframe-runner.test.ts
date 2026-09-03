import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    OcrIframeRunner,
    buildOcrChildScript,
    PER_WORD_CONF_FLOOR,
    MIN_MEAN_CONF,
} from './ocr-iframe-runner';

// The child realm (createImageBitmap, OffscreenCanvas, remote import()) has no
// node/vitest equivalent, so — exactly like iframe-runner.test.ts — the parent
// RPC/timeout is driven against an injected dead iframe, and the child script is
// asserted on its emitted TEXT rather than executed.
afterEach(() => { vi.useRealTimers(); });

// A live-looking iframe whose child never replies, with `ready` pre-resolved so
// ocr() skips buildIframe (which needs a real DOM we don't have) and goes
// straight to the 'ocr' RPC — where the per-RPC timeout is what we're testing.
function withDeadIframe(): OcrIframeRunner {
    const r = new OcrIframeRunner(['eng']);
    const inner = r as unknown as {
        iframe: { contentWindow: { postMessage: () => void } };
        ready: Promise<void>;
    };
    inner.iframe = { contentWindow: { postMessage: () => { /* child never replies */ } } };
    inner.ready = Promise.resolve();
    return r;
}

describe('OcrIframeRunner constructor — pack cleaning', () => {
    it('lower-cases, trims and dedupes the requested packs', () => {
        expect(new OcrIframeRunner([' ENG ', 'eng', 'deu']).langs).toEqual(['eng', 'deu']);
    });

    it('never loads zero packs — an empty request falls back to eng', () => {
        expect(new OcrIframeRunner([]).langs).toEqual(['eng']);
    });
});

describe('OcrIframeRunner per-RPC timeout (§5 transient)', () => {
    it('rejects a never-answered ocr() with a recoverable TIMEOUT error', async () => {
        vi.useFakeTimers();
        const r = withDeadIframe();
        const p = r.ocr(new ArrayBuffer(8));
        // TIMEOUT (not a load failure) → the pre-pass writes NO record and rides
        // the per-release retry.
        const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(120_001);   // OCR_RPC_TIMEOUT_MS + 1
        await assertion;
    });

    it('recycles the wedged realm after a timeout so the next ocr() rebuilds', async () => {
        vi.useFakeTimers();
        const r = withDeadIframe();
        const p = r.ocr(new ArrayBuffer(8));
        const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(120_001);
        await assertion;
        // recycle() drops the memoised load so ensureReady rebuilds next time.
        expect((r as unknown as { ready: unknown }).ready).toBeNull();
    });

    it('fast-fails the rest of the pass once a load failure was recorded (§5)', async () => {
        const r = new OcrIframeRunner(['eng']);
        (r as unknown as { loadFailed: boolean }).loadFailed = true;
        // No LOAD_RPC_TIMEOUT_MS wait per image after the first load failure.
        await expect(r.ocr(new ArrayBuffer(8))).rejects.toThrow(/load failed/i);
    });
});

// The child's RPC dispatch runs inside a srcdoc module script we can't execute in
// node — so assert on the emitted source, the same pattern as iframe-runner's
// buildChildScript tests.
describe('OCR iframe child script — message-source guard', () => {
    it('gates RPC dispatch on event.source === window.parent', () => {
        const script = buildOcrChildScript();
        const handlerStart = script.indexOf("addEventListener('message'");
        expect(handlerStart).toBeGreaterThan(-1);
        const guardIdx = script.indexOf('event.source !== window.parent', handlerStart);
        const dispatchIdx = script.indexOf("data.type === 'load'", handlerStart);
        expect(guardIdx).toBeGreaterThan(handlerStart);
        expect(guardIdx).toBeLessThan(dispatchIdx);
    });
});

describe('OCR iframe child script — tesseract wiring (§13)', () => {
    it('imports the ESM default export (a named createWorker import fails)', () => {
        const script = buildOcrChildScript();
        expect(script).toContain('mod.default.createWorker');
    });

    it('passes explicit workerPath / corePath / langPath and gzip', () => {
        const script = buildOcrChildScript();
        expect(script).toContain('workerPath: WORKER_PATH');
        expect(script).toContain('corePath: CORE_PATH');
        expect(script).toContain('langPath: LANG_PATH');
        expect(script).toContain('gzip: true');
    });

    it('is backtick-free so the parent template literal never evaluates it', () => {
        // The child is embedded in a parent template literal; a backtick (or ${})
        // inside would make the PARENT evaluate the child. Load-bearing.
        expect(buildOcrChildScript()).not.toContain('`');
    });
});

describe('OCR iframe child script — ranking-pollution gates (§6/§13)', () => {
    it('injects the per-word confidence floor and drops sub-floor words', () => {
        const script = buildOcrChildScript();
        expect(script).toContain(`const PER_WORD_CONF_FLOOR = ${PER_WORD_CONF_FLOOR}`);
        expect(script).toContain('>= PER_WORD_CONF_FLOOR');
    });

    it('injects the mean-confidence floor and drops the WHOLE image below it', () => {
        const script = buildOcrChildScript();
        expect(script).toContain(`const MIN_MEAN_CONF = ${MIN_MEAN_CONF}`);
        expect(script).toContain('meanConf < MIN_MEAN_CONF');
    });
});

describe('OCR iframe child script — deterministic failures resolve, never throw (§5)', () => {
    it('returns an `error: decode` record for undecodable bytes', () => {
        expect(buildOcrChildScript()).toContain("error: 'decode'");
    });

    it('returns an `error: pixel-cap` record for an over-cap image', () => {
        expect(buildOcrChildScript()).toContain("error: 'pixel-cap'");
    });
});

// The resize plan is SHARED with the parent by injecting planResize.toString() +
// its numeric constants (single source of truth, image-file.ts). Prove the
// injected preamble is self-contained by evaluating it exactly as the child sees
// it — no module scope, no imports — and running the shared math.
describe('OCR iframe child script — shared planResize is self-contained', () => {
    function evalPlanResize(): (w: number, h: number) => { scale?: number; targetW?: number; targetH?: number; reject?: string } {
        const script = buildOcrChildScript();
        const start = script.indexOf('const RESIZE_MIN_LONG_EDGE_PX');
        const end = script.indexOf('let worker = null;');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const preamble = script.slice(start, end);
        return new Function(preamble + '\nreturn planResize;')() as never;
    }

    it('downscales a long edge past the max window (4000×3000 → 3000×2250)', () => {
        const plan = evalPlanResize()(4000, 3000);
        expect(plan).toMatchObject({ targetW: 3000, targetH: 2250 });
    });

    it('rejects an image over the pixel cap', () => {
        expect(evalPlanResize()(6000, 5000)).toEqual({ reject: 'pixel-cap' });
    });
});
