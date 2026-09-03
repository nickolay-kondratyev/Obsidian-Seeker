// The desktop OCR pre-pass (search.ts ocrPrepass): it hashes each image, skips
// cache hits, calls the engine on misses, writes records, memoises path → sha256,
// and OCRs referenced-then-recent first (docs/research/image-ocr.md §5, §9 Q1).
import { describe, it, expect, afterEach } from 'vitest';
import { Scenario, encodeImage } from './test-harness/scenario';
import { sha256Hex, type OcrEngine, type OcrResult } from './ocr-cache';

const DIR = 'idx';
const pre = { scale: 1, maxEdge: 2000 };

// A recording engine: notes every ocr() in call order (bytes decoded as the tag),
// and can be told to THROW (transient) or return an error result (deterministic).
function recordingEngine(opts: { throwOn?: string; errorOn?: string } = {}): OcrEngine & { calls: string[] } {
    return {
        engine: 'rec', version: '1', langs: ['eng'], calls: [] as string[],
        async ocr(bytes: ArrayBuffer): Promise<OcrResult> {
            const text = new TextDecoder().decode(bytes);
            this.calls.push(text);
            if (opts.throwOn === text) throw new Error('transient engine failure');
            if (opts.errorOn === text) return { text: '', conf: 0, w: 1, hpx: 1, ms: 1, error: 'decode', pre };
            return { text, conf: 90, w: 1, hpx: 1, ms: 1, error: null, pre };
        },
    };
}

async function hashOf(text: string): Promise<string> {
    const b = encodeImage(text);
    return sha256Hex(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

describe('ocrPrepass', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; });

    const boot = async (engine: OcrEngine): Promise<Scenario> => {
        const s = new Scenario();
        await s.boot({ indexImages: true, sidecarEnabled: false }, { indexDir: DIR, ocrEngine: engine });
        active = s;
        return s;
    };

    it('writes a cache record for a miss', async () => {
        const s = await boot(recordingEngine());
        s.vault.writeImage('a.png', encodeImage('a-text'), 1);
        await s.orch.ocrPrepass(s.vault.getFiles());
        expect(s.vault.adapter.files.has(`${DIR}/ocr/${await hashOf('a-text')}.json`)).toBe(true);
    });

    it('does not re-call the engine for a byte-identical image already cached (§12 D2)', async () => {
        const engine = recordingEngine();
        const s = await boot(engine);
        s.vault.writeImage('a.png', encodeImage('shared'), 1);
        await s.orch.ocrPrepass(s.vault.getFiles());
        // A copy under a new name is the SAME bytes → same hash → a hit second time.
        s.vault.writeImage('copy.png', encodeImage('shared'), 2);
        await s.orch.ocrPrepass(s.vault.getFiles());
        expect(engine.calls).toEqual(['shared']);
    });

    it('memoises path → sha256 for the pass', async () => {
        const s = await boot(recordingEngine());
        s.vault.writeImage('a.png', encodeImage('memo-me'), 1);
        await s.orch.ocrPrepass(s.vault.getFiles());
        const memo = (s.orch as unknown as { ocrHashMemo: Map<string, string> }).ocrHashMemo;
        expect(memo.get('a.png')).toBe(await hashOf('memo-me'));
    });

    it('OCRs a referenced image before an unreferenced one, most-recent first within a group (§9 Q1)', async () => {
        const engine = recordingEngine();
        const s = await boot(engine);
        // Two unreferenced (old, new) + one referenced-by-a-note.
        s.vault.writeImage('unref-old.png', encodeImage('unref-old'), 100);
        s.vault.writeImage('unref-new.png', encodeImage('unref-new'), 900);
        s.vault.writeImage('ref.png', encodeImage('ref'), 500);
        s.resolvedLinks = { 'note.md': { 'ref.png': 1 } };
        await s.orch.ocrPrepass(s.vault.getFiles());
        expect(engine.calls).toEqual(['ref', 'unref-new', 'unref-old']);
    });

    it('writes NO record on a transient engine failure (stays dirty, retried later, §5)', async () => {
        const s = await boot(recordingEngine({ throwOn: 'boom' }));
        s.vault.writeImage('a.png', encodeImage('boom'), 1);
        await s.orch.ocrPrepass(s.vault.getFiles());
        expect(s.vault.adapter.files.has(`${DIR}/ocr/${await hashOf('boom')}.json`)).toBe(false);
    });

    it('writes an error record on a deterministic failure (final until Rebuild, §5)', async () => {
        const s = await boot(recordingEngine({ errorOn: 'undecodable' }));
        s.vault.writeImage('a.png', encodeImage('undecodable'), 1);
        await s.orch.ocrPrepass(s.vault.getFiles());
        const raw = await s.vault.adapter.read(`${DIR}/ocr/${await hashOf('undecodable')}.json`);
        expect(JSON.parse(raw).error).toBe('decode');
    });

    it('is a no-op when no engine is wired (a phone never OCRs)', async () => {
        const s = new Scenario();
        await s.boot({ indexImages: true, sidecarEnabled: false }, { indexDir: DIR });   // no ocrEngine
        active = s;
        s.vault.writeImage('a.png', encodeImage('noeng'), 1);
        await s.orch.ocrPrepass(s.vault.getFiles());
        expect(s.vault.adapter.files.size).toBe(0);
    });
});
