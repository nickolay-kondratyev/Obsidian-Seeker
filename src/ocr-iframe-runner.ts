// The OCR engine runtime: a SECOND srcdoc iframe (id `seeker-ocr-iframe`) that
// hosts tesseract.js 7 and answers one image at a time. It implements the pure
// `OcrEngine` contract (ocr-cache.ts) that the desktop pre-pass drives; the
// parent transfers raw image bytes, the CHILD decodes + resizes + recognises,
// and the runtime is UNMOUNTED the moment the pre-pass drains (§8a: the wasm
// heap never shrinks, so the only reclaim is destroying the worker).
//
// Why a separate iframe from the embedder (docs/research/image-ocr.md §5): same
// CSP reason as iframe-runner.ts (a srcdoc iframe inherits a permissive CSP and
// can `import()` from a CDN), but an INDEPENDENT heap — it can be torn down
// without touching the ~100 MB warm embedder, and an OCR crash / RPC timeout
// cannot take the embedder down. We reuse iframe-runner.ts's RPC/timeout/recycle
// SHAPE, not its code (one worker, sequential, no WebGPU, no warmup grid).
//
// LOAD-BEARING: NO `sandbox` attribute (identical to iframe-runner.ts's comment,
// §13). A sandboxed srcdoc iframe gets an opaque `null` origin, which breaks the
// Cache API (core + language packs would re-download every session) and the
// cross-origin CDN fetches. Do not add one.
//
// Desktop-only: the runtime is NEVER instantiated on mobile (main.ts gates on
// isMobilePlatform) — a phone reads the OCR cache and never runs the engine.

import type { OcrEngine, OcrResult } from './ocr-cache';
import { planResize, RESIZE_MIN_LONG_EDGE_PX, RESIZE_MAX_LONG_EDGE_PX, PIXEL_CAP } from './image-file';

// tesseract.js 7 from jsdelivr, with EXPLICIT paths proven by the spike (§13).
export const TESSERACT_ENGINE = 'tesseract.js';
export const TESSERACT_VERSION = '7.0.0';
const CDN = 'https://cdn.jsdelivr.net/npm';
const TESSERACT_ESM_URL = `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;
const WORKER_PATH = `${CDN}/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
// corePath is a DIRECTORY — tesseract picks tesseract-core-simd.wasm.js via
// wasm-feature-detect (§13). Trailing slash is required.
const CORE_PATH = `${CDN}/tesseract.js-core@${TESSERACT_VERSION}/`;
// tesseract's default tessdata host; `<lang>.traineddata.gz` per pack (§13).
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';
// OEM.LSTM_ONLY — the neural engine the spike used (createWorker's 2nd arg).
const OEM_LSTM_ONLY = 1;

// Ranking-pollution gate (§6, §13 spike constants). tesseract confidences are
// 0-100. Exported for the child-script test.
export const PER_WORD_CONF_FLOOR = 60;   // drop words below this
export const MIN_MEAN_CONF = 65;         // drop the WHOLE image below this (empty text)

const IFRAME_ID = 'seeker-ocr-iframe';
const READY_TIMEOUT_MS = 30_000;
// A cold first-ever load streams core-simd (~4.7 MB) + a language pack
// (eng ~11 MB) from the CDN (§13: ~2.5 s cold, ~140 ms warm) — a generous
// budget so a slow first download never trips the timeout and quarantines the
// vault. A per-image recognize is ~200 ms (§13); it shares the same ceiling
// since a large pathological image can run seconds.
const LOAD_RPC_TIMEOUT_MS = 180_000;
const OCR_RPC_TIMEOUT_MS = 120_000;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer?: number;
}

interface IframeMsg {
    id: string;
    ok?: boolean;
    result?: unknown;
    error?: string;
}

export class OcrIframeRunner implements OcrEngine {
    readonly engine = TESSERACT_ENGINE;
    readonly version = TESSERACT_VERSION;
    readonly langs: string[];

    private iframe: HTMLIFrameElement | null = null;
    private pending = new Map<string, Pending>();
    private listener: ((e: MessageEvent) => void) | null = null;
    // Memoised iframe-build + worker-load. Null until first ocr(); reset by
    // teardown() so the NEXT pre-pass rebuilds fresh (the whole point of tearing
    // the wasm heap down between passes).
    private ready: Promise<void> | null = null;
    // A load failure fast-fails the REST of this pass: without it a CDN outage
    // would spend LOAD_RPC_TIMEOUT_MS per image before each is quarantined.
    // Cleared by teardown() so a later pass retries.
    private loadFailed = false;

    constructor(langs: string[]) {
        // At least one pack, deduped — the caller (effectiveOcrLangs) already
        // guarantees this, but the engine must never load zero packs.
        const cleaned = [...new Set(langs.map(l => l.trim().toLowerCase()).filter(l => l.length > 0))];
        this.langs = cleaned.length > 0 ? cleaned : ['eng'];
    }

    // Recognise one image. Throws (TRANSIENT, §5) on an engine-load failure or an
    // RPC timeout/crash — the pre-pass then writes NO cache record and rides the
    // per-release retry. A DETERMINISTIC failure (undecodable bytes, over the
    // pixel cap) resolves with an OcrResult whose `error` is set — a final record.
    async ocr(bytes: ArrayBuffer): Promise<OcrResult> {
        if (this.loadFailed) throw new Error('OCR engine load failed earlier this pass');
        try {
            await this.ensureReady();
        } catch (e) {
            // Recycle so a wedged/failed realm doesn't poison the retry, and the
            // next pass (after teardown resets loadFailed) rebuilds clean.
            this.dispose();
            throw e instanceof Error ? e : new Error(String(e));
        }
        try {
            return await this.send<OcrResult>('ocr', { bytes }, OCR_RPC_TIMEOUT_MS, [bytes]);
        } catch (e) {
            // A timeout / child crash means this realm may be wedged — recycle it
            // so the NEXT image gets a fresh worker rather than N cascading
            // timeouts. The next ocr() rebuilds via ensureReady.
            this.recycle();
            throw e instanceof Error ? e : new Error(String(e));
        }
    }

    // Unmount the iframe + terminate the worker (§8a). Idempotent; resets the
    // load state so a subsequent pass rebuilds. Called by the pre-pass once its
    // queue drains and by the plugin on unload / OCR-off.
    async teardown(): Promise<void> {
        this.dispose();
    }

    private ensureReady(): Promise<void> {
        if (this.ready) return this.ready;
        this.ready = (async () => {
            await this.buildIframe();
            await this.send<{ ok: boolean }>('load', { langs: this.langs }, LOAD_RPC_TIMEOUT_MS);
        })().catch(e => {
            this.loadFailed = true;
            throw e instanceof Error ? e : new Error(String(e));
        });
        return this.ready;
    }

    private buildIframe(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(
                () => reject(new Error(`OCR iframe ready timeout after ${READY_TIMEOUT_MS}ms`)),
                READY_TIMEOUT_MS,
            );
            this.listener = (event: MessageEvent) => {
                if (!this.iframe || event.source !== this.iframe.contentWindow) return;
                const data = event.data as IframeMsg | undefined;
                if (!data || typeof data !== 'object') return;
                if (data.id === '__ready') { window.clearTimeout(timeout); resolve(); return; }
                if (data.id === '__error') {
                    window.clearTimeout(timeout);
                    reject(new Error(`OCR iframe bootstrap failed: ${data.error}`));
                    return;
                }
                const p = this.pending.get(data.id);
                if (!p) return;
                this.pending.delete(data.id);
                if (p.timer) window.clearTimeout(p.timer);
                if (data.ok) p.resolve(data.result);
                else p.reject(new Error(data.error ?? 'OCR iframe error'));
            };
            window.addEventListener('message', this.listener);

            // Anchor to the MAIN window's document (never activeDocument): it is
            // display:none, must outlive any popout, and its contentWindow must
            // reach the `window` message listener bound above. Same reasoning as
            // iframe-runner.ts.
            this.iframe = window.document.createElement('iframe');
            this.iframe.id = IFRAME_ID;
            this.iframe.addClass('seeker-hidden');
            // LOAD-BEARING: no `sandbox` attribute (see the file header).
            window.document.body.appendChild(this.iframe);
            this.iframe.srcdoc =
                `<!DOCTYPE html><html><body><script type="module">${buildOcrChildScript()}</script></body></html>`;
        });
    }

    private send<T>(type: string, payload: unknown, timeoutMs: number, transfer?: Transferable[]): Promise<T> {
        if (!this.iframe?.contentWindow) return Promise.reject(new Error('OCR iframe not initialized'));
        const id = (crypto as { randomUUID?: () => string }).randomUUID
            ? (crypto as { randomUUID: () => string }).randomUUID()
            : `id-${Date.now()}-${Math.random()}`;
        return new Promise<T>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                if (!this.pending.delete(id)) return;
                reject(Object.assign(new Error(`OCR iframe RPC '${type}' timed out after ${timeoutMs}ms`), { code: 'TIMEOUT' }));
            }, timeoutMs);
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
            this.iframe!.contentWindow!.postMessage({ id, type, payload }, '*', transfer ?? []);
        });
    }

    // Drop the iframe but keep the runner usable — the next ocr() rebuilds via
    // ensureReady. Clears the memoised promise WITHOUT setting loadFailed (a
    // per-image timeout is not a load failure).
    private recycle(): void {
        this.tearDownIframe('OCR iframe recycled');
        this.ready = null;
    }

    // Full teardown: unmount + reset load state so a later pass starts clean.
    private dispose(): void {
        this.tearDownIframe('OCR iframe disposed');
        this.ready = null;
        this.loadFailed = false;
    }

    private tearDownIframe(rejectMsg: string): void {
        if (this.listener) {
            window.removeEventListener('message', this.listener);
            this.listener = null;
        }
        if (this.iframe?.parentNode) this.iframe.parentNode.removeChild(this.iframe);
        this.iframe = null;
        for (const [, p] of this.pending) {
            if (p.timer) window.clearTimeout(p.timer);
            p.reject(new Error(rejectMsg));
        }
        this.pending.clear();
    }
}

// The script body that runs INSIDE the OCR iframe. Exported for testing — the
// srcdoc realm (createImageBitmap, OffscreenCanvas, remote import) has no
// node/vitest equivalent, so tests assert on the emitted script text instead
// (the same pattern as iframe-runner.ts's buildChildScript).
//
// NOTE: this is a template literal in the parent — code inside must NOT use
// backticks or ${}, only single-quote concatenation, or the parent evaluates it.
// The resize plan is SHARED with the parent by injecting the numeric constants
// and planResize's source (the seq-ladder sharing pattern, §5), so the exact
// same math shapes the OCR input and the parent's queue/tests.
export function buildOcrChildScript(): string {
    return `
const TESSERACT_ESM_URL = ${JSON.stringify(TESSERACT_ESM_URL)};
const WORKER_PATH = ${JSON.stringify(WORKER_PATH)};
const CORE_PATH = ${JSON.stringify(CORE_PATH)};
const LANG_PATH = ${JSON.stringify(LANG_PATH)};
const OEM_LSTM_ONLY = ${JSON.stringify(OEM_LSTM_ONLY)};
const PER_WORD_CONF_FLOOR = ${JSON.stringify(PER_WORD_CONF_FLOOR)};
const MIN_MEAN_CONF = ${JSON.stringify(MIN_MEAN_CONF)};
// Resize constants + planResize SHARED with the parent (single source of truth,
// image-file.ts). planResize is self-contained given these three consts.
const RESIZE_MIN_LONG_EDGE_PX = ${JSON.stringify(RESIZE_MIN_LONG_EDGE_PX)};
const RESIZE_MAX_LONG_EDGE_PX = ${JSON.stringify(RESIZE_MAX_LONG_EDGE_PX)};
const PIXEL_CAP = ${JSON.stringify(PIXEL_CAP)};
const planResize = ${planResize.toString()};

let worker = null;

// createWorker with EXPLICIT paths (§13): the ESM build exposes ONLY a default
// export (the Tesseract namespace) — a named { createWorker } import FAILS.
async function ensureWorker(langs) {
    if (worker) return worker;
    const mod = await import(TESSERACT_ESM_URL);
    const createWorker = mod.default.createWorker;
    worker = await createWorker(langs, OEM_LSTM_ONLY, {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        workerBlobURL: true,
        gzip: true,
    });
    return worker;
}

// Decode (EXIF applied) -> resize during decode via createImageBitmap -> draw to
// an OffscreenCanvas (a valid tesseract ImageLike) -> recognize. Returns an
// OcrResult; a decode failure / pixel-cap reject is a DETERMINISTIC error record
// (error set), never a throw (§5).
async function runOcr(bytes) {
    const t0 = performance.now();
    const pre = { scale: 1, maxEdge: RESIZE_MAX_LONG_EDGE_PX };
    let full = null;
    try {
        full = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' });
    } catch (e) {
        return { text: '', conf: 0, w: 0, hpx: 0, ms: performance.now() - t0, error: 'decode', pre: pre };
    }
    const plan = planResize(full.width, full.height);
    if (plan.reject) {
        const w = full.width, hpx = full.height;
        full.close();
        return { text: '', conf: 0, w: w, hpx: hpx, ms: performance.now() - t0, error: 'pixel-cap', pre: pre };
    }
    pre.scale = plan.scale;
    let bmp = full;
    if (plan.scale !== 1) {
        try {
            bmp = await createImageBitmap(full, { resizeWidth: plan.targetW, resizeHeight: plan.targetH, resizeQuality: 'high' });
        } catch (e) {
            full.close();
            return { text: '', conf: 0, w: 0, hpx: 0, ms: performance.now() - t0, error: 'decode', pre: pre };
        }
        full.close();
    }
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const w = bmp.width, hpx = bmp.height;
    bmp.close();

    const out = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const data = out.data;
    // Whole-image gate: mean confidence < MIN_MEAN_CONF drops the WHOLE image
    // (genuine noise becomes empty text, not competing dense vectors — §6/§13).
    const meanConf = typeof data.confidence === 'number' ? data.confidence : 0;
    if (meanConf < MIN_MEAN_CONF) {
        return { text: '', conf: meanConf, w: w, hpx: hpx, ms: performance.now() - t0, error: null, pre: pre };
    }
    // Per-word floor: keep only words at/above PER_WORD_CONF_FLOOR, one line per
    // recognised line (§13 #1 — cheapest mitigation).
    const lines = [];
    const blocks = data.blocks || [];
    for (let bi = 0; bi < blocks.length; bi++) {
        const paras = blocks[bi].paragraphs || [];
        for (let pi = 0; pi < paras.length; pi++) {
            const ls = paras[pi].lines || [];
            for (let li = 0; li < ls.length; li++) {
                const words = ls[li].words || [];
                const kept = [];
                for (let wi = 0; wi < words.length; wi++) {
                    if ((words[wi].confidence || 0) >= PER_WORD_CONF_FLOOR) kept.push(words[wi].text);
                }
                if (kept.length > 0) lines.push(kept.join(' '));
            }
        }
    }
    const text = lines.join('\\n').trim();
    return { text: text, conf: meanConf, w: w, hpx: hpx, ms: performance.now() - t0, error: null, pre: pre };
}

window.addEventListener('message', async function (event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.id !== 'string') return;
    try {
        if (data.type === 'load') {
            await ensureWorker(data.payload.langs);
            window.parent.postMessage({ id: data.id, ok: true, result: { ok: true } }, '*');
        } else if (data.type === 'ocr') {
            const result = await runOcr(data.payload.bytes);
            window.parent.postMessage({ id: data.id, ok: true, result: result }, '*');
        } else {
            window.parent.postMessage({ id: data.id, ok: false, error: 'unknown RPC type: ' + data.type }, '*');
        }
    } catch (e) {
        window.parent.postMessage({ id: data.id, ok: false, error: String((e && e.stack) || e) }, '*');
    }
});

window.parent.postMessage({ id: '__ready' }, '*');
`;
}
