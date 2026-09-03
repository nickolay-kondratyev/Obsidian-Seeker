// The per-hash OCR cache (ocr-cache.ts): get/put/list/clear, the hit-regardless-
// of-provenance rule (§12 D2), and the text a record contributes to the index.
import { describe, it, expect, beforeEach } from 'vitest';
import { OcrCache, ocrText, sha256Hex, type OcrCacheAdapter, type OcrRecord } from './ocr-cache';

// In-memory adapter — the structural subset OcrCache needs. Paths are opaque keys.
class MemAdapter implements OcrCacheAdapter {
    files = new Map<string, string>();
    dirs = new Set<string>();
    async read(path: string): Promise<string> {
        const v = this.files.get(path);
        if (v === undefined) throw new Error(`ENOENT ${path}`);
        return v;
    }
    async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
    async exists(path: string): Promise<boolean> { return this.files.has(path) || this.dirs.has(path); }
    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const prefix = `${path}/`;
        const files = [...this.files.keys()].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
        return { files, folders: [] };
    }
    async remove(path: string): Promise<void> { this.files.delete(path); }
    async mkdir(path: string): Promise<void> { this.dirs.add(path); }
    async stat(path: string): Promise<{ size: number } | null> {
        const v = this.files.get(path);
        return v === undefined ? null : { size: v.length };
    }
}

const DIR = '.obsidian/plugins/seeker/index';

function rec(over: Partial<OcrRecord> = {}): OcrRecord {
    return {
        h: 'a'.repeat(64), engine: 'tesseract.js', v: '7.0.0', langs: ['eng'],
        pre: { scale: 2, maxEdge: 2000 }, plugin: '1.0.0',
        text: 'hello world', conf: 90, w: 1440, hpx: 900, ms: 100, ts: 1, error: null,
        ...over,
    };
}

describe('sha256Hex', () => {
    it('is a 64-char hex digest, deterministic per bytes', async () => {
        const a = await sha256Hex(new Uint8Array([1, 2, 3]).buffer);
        const b = await sha256Hex(new Uint8Array([1, 2, 3]).buffer);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('differs for different bytes', async () => {
        const a = await sha256Hex(new Uint8Array([1]).buffer);
        const b = await sha256Hex(new Uint8Array([2]).buffer);
        expect(a).not.toBe(b);
    });
});

describe('OcrCache get/put/has', () => {
    let cache: OcrCache;
    beforeEach(() => { cache = new OcrCache(new MemAdapter(), DIR); });

    it('returns null on a miss', async () => {
        expect(await cache.get('b'.repeat(64))).toBeNull();
    });

    it('round-trips a stored record', async () => {
        await cache.put(rec());
        expect(await cache.get('a'.repeat(64))).toMatchObject({ text: 'hello world', conf: 90 });
    });

    it('has() reflects a stored record', async () => {
        await cache.put(rec());
        expect(await cache.has('a'.repeat(64))).toBe(true);
    });
});

describe('OcrCache hit rules (§12 D2 — provenance never causes a miss)', () => {
    it('serves a record whose engine / version / langs differ from the live config', async () => {
        const cache = new OcrCache(new MemAdapter(), DIR);
        await cache.put(rec({ engine: 'old-engine', v: '1.0.0', langs: ['deu'] }));
        // The live config is tesseract.js 7 / eng, but the stale record is still served.
        expect(await cache.get('a'.repeat(64))).toMatchObject({ text: 'hello world' });
    });
});

describe('OcrCache list (status card)', () => {
    it('lists every stored hash with its byte size', async () => {
        const cache = new OcrCache(new MemAdapter(), DIR);
        await cache.put(rec({ h: 'a'.repeat(64) }));
        await cache.put(rec({ h: 'c'.repeat(64) }));
        const listed = await cache.list();
        expect(listed.map(e => e.hash).sort()).toEqual(['a'.repeat(64), 'c'.repeat(64)]);
        expect(listed.every(e => e.bytes > 0)).toBe(true);
    });

    it('is empty before anything is written', async () => {
        expect(await new OcrCache(new MemAdapter(), DIR).list()).toEqual([]);
    });
});

describe('OcrCache clear (§12 D8)', () => {
    it('removes every record', async () => {
        const cache = new OcrCache(new MemAdapter(), DIR);
        await cache.put(rec());
        await cache.clear();
        expect(await cache.get('a'.repeat(64))).toBeNull();
        expect(await cache.list()).toEqual([]);
    });
});

describe('ocrText — what a record contributes to the index', () => {
    it('yields the text of a normal record', () => {
        expect(ocrText(rec({ text: 'screenshot text' }))).toBe('screenshot text');
    });

    it('yields empty for a text-free record (§4 zero-chunk image)', () => {
        expect(ocrText(rec({ text: '', conf: 0 }))).toBe('');
    });

    it('yields empty for an error record (deterministic failure, §5)', () => {
        expect(ocrText(rec({ text: '', error: 'decode-failure' }))).toBe('');
    });
});
