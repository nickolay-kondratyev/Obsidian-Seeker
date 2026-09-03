// Cross-module scenario: an image rides the REAL index pipeline (collect →
// contentFor → chunksFor → chunkContent → embed → store) through the tier-2
// harness, and each sidecar liveness oracle re-derives the same ids. Pins the
// wiring of docs/research/image-ocr.md §2a/§4/§5 that no unit test can see:
// contentFor is cache-only, an image is its own document titled WITH the
// extension, a cache MISS is UNKNOWN (never zero chunks) at every site, a
// text-free / error record persists a chunk_ids:[] FileRecord, the oracles never
// re-read unchanged image bytes, and Clear/Rebuild invalidation re-chunks images.
import { describe, it, expect, afterEach } from 'vitest';
import type { TFile } from 'obsidian';
import { Scenario, fakeOcrEngine, encodeImage } from './test-harness/scenario';
import { MarkdownChunker } from './chunker';
import { sha256Hex, type OcrRecord } from './ocr-cache';
import type { ReChunkedNote } from './sidecar-sync';

const DIR = 'idx';
// Image scenarios pass an index dir (so the OCR cache is live) with the sidecar
// OFF — the cache is written whether or not the sidecar is on (§3), and off keeps
// the harness free of sidecar file writes.
const OCR_SETTINGS = { indexImages: true, sidecarEnabled: false } as const;

// Private oracle/contentFor entry points the ticket routes through contentFor.
interface OrchInternals {
    reChunkLive(): Promise<ReChunkedNote[]>;
    collectLiveIds(): Promise<{ ids: Set<string>; complete: boolean }>;
    dedupViaSidecar(files: TFile[]): Promise<TFile[]>;
    carryOverHydrate(files: TFile[], carryOver: Map<string, unknown>): Promise<TFile[]>;
}
const internals = (s: Scenario): OrchInternals => s.orch as unknown as OrchInternals;

async function hashOf(bytes: Uint8Array): Promise<string> {
    return sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

describe('image indexing wiring (search.ts contentFor + image gate)', () => {
    let active: Scenario | null = null;
    const boot = async (opts: { engine?: boolean } = {}): Promise<Scenario> => {
        const s = new Scenario();
        await s.boot(OCR_SETTINGS, { indexDir: DIR, ocrEngine: opts.engine === false ? undefined : fakeOcrEngine() });
        active = s;
        return s;
    };
    afterEach(async () => { await active?.teardown(); active = null; });

    it('indexes an OCR hit as its own document titled WITH the extension (§2a, §12 D5)', async () => {
        const s = await boot();
        s.vault.writeImage('Attachments/Whiteboard.png', encodeImage('the quarterly product roadmap lists the milestones for shipping search'), 1000);
        await s.ocrColdStart();

        const rows = (await s.store.listAllMeta()).filter(m => m.note_path === 'Attachments/Whiteboard.png');
        expect(rows.map(m => m.title)).toEqual(['Whiteboard.png']);
    });

    it('chunk_id parity: the stored image ids equal an independent chunkContent re-derivation', async () => {
        const s = await boot();
        s.vault.writeImage('shot.png', encodeImage('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'), 1000);
        await s.ocrColdStart();

        const stored = (await s.store.listAllMeta()).filter(m => m.note_path === 'shot.png').map(m => m.chunk_id).sort();
        const expected = new MarkdownChunker()
            .chunkContent('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima', 'shot.png', 'shot.png', new Date(1000).toISOString())
            .map(c => c.chunk_id).sort();
        expect(stored).toEqual(expected);
    });

    it('a cache MISS in the embed path leaves the image un-indexed and still dirty (§4)', async () => {
        const s = await boot({ engine: false });   // no engine → cache never filled
        s.vault.writeImage('miss.png', encodeImage('never ocr\'d'), 1000);
        await s.orch.reindexAll();                  // no pre-pass, so the cache has no record

        expect(await s.store.getFileRecord('miss.png')).toBeUndefined();
        expect((await s.orch.computeDelta()).dirty).toContain('miss.png');
    });

    it('a text-free image persists a chunk_ids:[] FileRecord that reads clean (§4)', async () => {
        const s = await boot();
        s.vault.writeImage('blank.png', encodeImage(''), 1000);   // engine → empty text record
        await s.ocrColdStart();

        expect((await s.store.getFileRecord('blank.png'))?.chunk_ids).toEqual([]);
    });

    it('a text-free image is NOT reported dirty on the next sweep (no binary re-read churn, §4)', async () => {
        const s = await boot();
        s.vault.writeImage('blank.png', encodeImage(''), 1000);
        await s.ocrColdStart();

        expect((await s.orch.computeDelta()).dirty).not.toContain('blank.png');
    });

    it('an error record persists a chunk_ids:[] FileRecord (§5 deterministic failure)', async () => {
        const s = await boot();
        s.vault.writeImage('bad.png', encodeImage('ERR:decode-failure'), 1000);
        await s.ocrColdStart();

        const rec = await s.store.getFileRecord('bad.png');
        expect(rec?.chunk_ids).toEqual([]);
    });

    it("the stored image contentHash is the bytes' sha256, not a text hash (§3)", async () => {
        const s = await boot();
        const bytes = encodeImage('some screenshot text');
        s.vault.writeImage('shot.png', bytes, 1000);
        await s.ocrColdStart();

        expect((await s.store.getFileRecord('shot.png'))?.contentHash).toBe(await hashOf(bytes));
    });
});

describe('image no-re-read rule (§4: oracles never re-read unchanged image bytes)', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; });

    const bootIndexed = async (): Promise<Scenario> => {
        const s = new Scenario();
        await s.boot(OCR_SETTINGS, { indexDir: DIR, ocrEngine: fakeOcrEngine() });
        active = s;
        s.vault.writeImage('shot.png', encodeImage('stable screenshot text that the liveness oracle re-derives every session'), 1000);
        await s.ocrColdStart();
        s.vault.readBinaryCalls = 0;   // reset AFTER indexing; the sweep below must add none
        return s;
    };

    it('collectLiveIds sweeps an unchanged image with 0 readBinary calls', async () => {
        const s = await bootIndexed();
        await internals(s).collectLiveIds();
        expect(s.vault.readBinaryCalls).toBe(0);
    });

    it('reChunkLive sweeps an unchanged image with 0 readBinary calls', async () => {
        const s = await bootIndexed();
        await internals(s).reChunkLive();
        expect(s.vault.readBinaryCalls).toBe(0);
    });

    it('computeDelta reuses the stored hash for an unchanged image (0 readBinary calls)', async () => {
        const s = await bootIndexed();
        await s.orch.computeDelta();
        expect(s.vault.readBinaryCalls).toBe(0);
    });
});

describe('image cache-miss is UNKNOWN at every oracle, never zero chunks (§4)', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; });

    // No engine → the image's OCR text is never cached, so every oracle sees UNKNOWN.
    const bootMiss = async (): Promise<Scenario> => {
        const s = new Scenario();
        await s.boot(OCR_SETTINGS, { indexDir: DIR });
        active = s;
        s.vault.writeImage('miss.png', encodeImage('uncached'), 1000);
        return s;
    };

    it('reChunkLive skips the unknown image (not in its output)', async () => {
        const s = await bootMiss();
        const out = await internals(s).reChunkLive();
        expect(out.map(n => n.notePath)).not.toContain('miss.png');
    });

    it('collectLiveIds reports the snapshot INCOMPLETE (never tombstones live ids)', async () => {
        const s = await bootMiss();
        expect((await internals(s).collectLiveIds()).complete).toBe(false);
    });

    it('carryOverHydrate skips the unknown image (returns it for normal embed)', async () => {
        const s = await bootMiss();
        const img = s.vault.getAbstractFileByPath('miss.png')!;
        const carryOver = new Map<string, unknown>([['x', {}]]);   // non-empty so the guard runs
        const remaining = await internals(s).carryOverHydrate([img], carryOver);
        expect(remaining.map(f => f.path)).toEqual(['miss.png']);
    });

    it('dedupViaSidecar skips the unknown image (returns it for normal embed)', async () => {
        const s = new Scenario();
        await s.boot({ indexImages: true }, { indexDir: DIR });   // sidecar ON so dedup runs
        active = s;
        s.vault.writeImage('miss.png', encodeImage('uncached'), 1000);
        const img = s.vault.getAbstractFileByPath('miss.png')!;
        const remaining = await internals(s).dedupViaSidecar([img]);
        expect(remaining.map(f => f.path)).toEqual(['miss.png']);
    });
});

describe('OCR cache invalidation for Clear / Rebuild (§12 D8)', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; });

    it('a cache rewrite ALONE does not reach the index — the image reads clean (§4)', async () => {
        const s = new Scenario();
        await s.boot(OCR_SETTINGS, { indexDir: DIR, ocrEngine: fakeOcrEngine() });
        active = s;
        const bytes = encodeImage('the original ocr text extracted from the very first engine run here');
        s.vault.writeImage('shot.png', bytes, 1000);
        await s.ocrColdStart();
        const before = (await s.store.getAllChunkIds()).sort();

        await rewriteRecord(s, bytes, 'rewritten ocr text');
        await s.reconcile();   // delta: the image is 'clean' (bytes unchanged), so nothing re-chunks

        expect((await s.store.getAllChunkIds()).sort()).toEqual(before);
    });

    it('after invalidateImageRecords, the rewritten text produces NEW chunk ids (Rebuild)', async () => {
        const s = new Scenario();
        await s.boot(OCR_SETTINGS, { indexDir: DIR, ocrEngine: fakeOcrEngine() });
        active = s;
        const bytes = encodeImage('the original ocr text extracted from the very first engine run here');
        s.vault.writeImage('shot.png', bytes, 1000);
        await s.ocrColdStart();
        const before = (await s.store.getAllChunkIds()).sort();

        await rewriteRecord(s, bytes, 'the rebuilt ocr text from a better engine that is clearly different now');
        const dropped = await s.orch.invalidateImageRecords();   // §12 D8: drop the image FileRecord + rows
        await s.reconcile();                                     // now the image is never-indexed → dirty → re-chunks

        expect(dropped).toBe(1);
        expect((await s.store.getAllChunkIds()).sort()).not.toEqual(before);
    });
});

// Overwrite the cache record for `bytes` with new text, as a better engine would
// on a Rebuild (same content hash, new provenance/text).
async function rewriteRecord(s: Scenario, bytes: Uint8Array, text: string): Promise<void> {
    const h = await hashOf(bytes);
    const rec: OcrRecord = {
        h, engine: 'rebuilt', v: '2', langs: ['eng'], pre: { scale: 1, maxEdge: 2000 },
        plugin: 'test', text, conf: 90, w: 100, hpx: 100, ms: 1, ts: 2, error: null,
    };
    await s.vault.adapter.write(`${DIR}/ocr/${h}.json`, JSON.stringify(rec));
}

describe('pass-scoped hash memo is validated against the live mtime (§5 / §4 TOCTOU)', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; });

    it('an image edited AFTER the pre-pass hashed it embeds the NEW bytes, not the memoised hash', async () => {
        const s = new Scenario();
        await s.boot(OCR_SETTINGS, { indexDir: DIR, ocrEngine: fakeOcrEngine() });
        active = s;
        s.vault.writeImage('shot.png', encodeImage('version one of the screenshot text that is long enough to chunk'), 1000);
        await s.ocrColdStart();
        // Pre-pass over v2 memoises path → sha256(v2) for the embed loop …
        s.vault.writeImage('shot.png', encodeImage('version two of the screenshot text that is long enough to chunk'), 2000);
        await s.orch.ocrPrepass([s.vault.getAbstractFileByPath('shot.png')!]);
        // … then the file is edited AGAIN before the embed loop reaches it (its
        // text already cached, e.g. by a peer), so the memo is stale for this mtime.
        const v3 = encodeImage('version three of the screenshot text that is long enough to chunk');
        s.vault.writeImage('shot.png', v3, 3000);
        await rewriteRecord(s, v3, 'version three of the screenshot text that is long enough to chunk');
        await s.orch.reindexDelta(['shot.png'], [], { embed: true });   // embed WITHOUT computeDelta's memo clear

        expect((await s.store.getFileRecord('shot.png'))?.contentHash).toBe(await hashOf(v3));
    });
});
