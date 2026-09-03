// Chunk-diff commit (issue #5) — Tier-2 scenarios through the REAL pipeline.
//
// The claim under test: an incremental delta re-embeds ONLY the chunks whose
// content-hash id actually changed. Id-stable chunks keep their IDB rows and
// vectors; their metadata reconciles through the meta-patch (BM25-irrelevant
// drift) or reindex-row (BM25-relevant drift, vector reused) lanes. The old
// behavior — delete the whole file, re-embed all 91 chunks for a one-paragraph
// edit — is exactly the wlo2 hot-note cascade.
//
// Scenarios run the real SearchOrchestrator + IndexStore (fake-indexeddb) with
// the deterministic embedder; embeds are observed by wrapping embedBatch. The
// "no applyDelta fallback" assertions ride a console.info spy — a successful
// incremental patch is silent, every decline logs '[seeker] applyDelta fallback'.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Scenario } from './test-harness/scenario';
import { chunkMetaEqual } from './search';
import { MultiFieldBM25 } from './bm25';
import { findOrphanChunkIds } from './index-store';
import type { ChunkMeta } from './types';

// Three heading sections, each fat enough to clear min-chunk gating. Section
// bodies are keyword-distinct so embed inputs are attributable.
function noteBody(a: string, b: string, c: string): string {
    const pad = (w: string): string => Array.from({ length: 40 }, (_, i) => `${w}${i % 7}`).join(' ');
    return `## Alpha\n\n${a} ${pad('alpha')}\n\n## Bravo\n\n${b} ${pad('bravo')}\n\n## Charlie\n\n${c} ${pad('charlie')}`;
}

interface Ctx { s: Scenario; embedded: string[]; infoSpy: ReturnType<typeof vi.spyOn> }
const open: Scenario[] = [];
afterEach(async () => { for (const s of open.splice(0)) await s.teardown(); vi.restoreAllMocks(); });

// Wait for the cold build's fire-and-forget warmCaches to land. An edit racing
// the warm is a REAL (and guarded) production interleaving — applyDelta's
// mismatch/coherence nets decline it into a rebuild — but these tests assert
// the incremental path, so they start from a settled warm state.
async function settleWarm(s: Scenario): Promise<void> {
    const o = s.orch as unknown as { bm25Cache: unknown; frameCache: unknown };
    const t0 = Date.now();
    while ((!o.bm25Cache || !o.frameCache) && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 10));
    if (!o.bm25Cache || !o.frameCache) throw new Error('warm never settled');
}

// Ballast keeps the frame large enough that a whole-note edit's tombstones stay
// under the 25% compaction threshold (a 3-row corpus would trip it on ANY
// removal — a small-corpus artifact, not the behavior under test).
function ballastBody(): string {
    return Array.from({ length: 30 }, (_, i) =>
        `## Filler ${i}\n\n${Array.from({ length: 40 }, (_, j) => `ballast${i}x${j % 7}`).join(' ')}`).join('\n\n');
}

async function bootWithNote(body: string): Promise<Ctx> {
    const s = new Scenario();
    open.push(s);
    await s.boot();
    s.vault.write('Ballast.md', ballastBody(), 900);
    s.vault.write('Note.md', body, 1000);
    await s.coldStart();
    await settleWarm(s);
    // Observe every embed AFTER the cold build (the deltas under test).
    const embedded: string[] = [];
    const orig = s.embedder.embedBatch.bind(s.embedder);
    s.embedder.embedBatch = (async (texts: string[]) => { embedded.push(...texts); return orig(texts); }) as typeof s.embedder.embedBatch;
    const infoSpy = vi.spyOn(console, 'info');
    return { s, embedded, infoSpy };
}

function fallbackLogs(infoSpy: ReturnType<typeof vi.spyOn>): string[] {
    return infoSpy.mock.calls.map(c => String(c[0])).filter(m => m.includes('applyDelta fallback'));
}

describe('chunk-diff commit — only changed chunks re-embed', () => {
    it('a one-section edit embeds that section only; stable rows and record survive', async () => {
        const { s, embedded, infoSpy } = await bootWithNote(noteBody('one', 'two', 'three'));
        const before = new Map((await s.store.listAllMeta()).map(m => [m.chunk_id, m]));

        await s.edit('Note.md', noteBody('one', 'two EDITED', 'three'), 2000);

        // Exactly the Bravo replacement embedded — nothing containing the
        // untouched sections' distinctive tokens.
        expect(embedded.length).toBeGreaterThan(0);
        expect(embedded.some(t => t.includes('EDITED'))).toBe(true);
        expect(embedded.some(t => t.includes('alpha0') && !t.includes('EDITED'))).toBe(false);
        expect(embedded.some(t => t.includes('charlie0') && !t.includes('EDITED'))).toBe(false);

        // The incremental patch applied — no fallback was logged.
        expect(fallbackLogs(infoSpy)).toEqual([]);

        // Record lists stable + new ids; the stale Bravo id is gone from the
        // store; no orphans anywhere (all meta rows referenced by some record).
        const rec = await s.store.getFileRecord('Note.md');
        const ballast = await s.store.getFileRecord('Ballast.md');
        const metas = await s.store.listAllMeta();
        expect(rec).not.toBeNull();
        expect(new Set(rec!.chunk_ids).size).toBe(rec!.chunk_ids.length);
        const referenced = new Set([...rec!.chunk_ids, ...(ballast?.chunk_ids ?? [])]);
        expect(findOrphanChunkIds(metas.map(m => m.chunk_id), referenced)).toEqual([]);
        expect(metas.length).toBe(referenced.size);
        // The stable ids are the SAME rows as before the edit (never deleted).
        const stillStable = rec!.chunk_ids.filter(id => before.has(id));
        expect(stillStable.length).toBeGreaterThan(0);
    });

    it('appends a delta-apply entry recording the incremental patch (v16 telemetry)', async () => {
        const { s } = await bootWithNote(noteBody('one', 'two', 'three'));
        const appended: Array<Record<string, unknown>> = [];
        const orch = s.orch as unknown as { logger: { append: (e: Record<string, unknown>) => Promise<void> } };
        const origAppend = orch.logger.append.bind(orch.logger);
        orch.logger.append = async (e): Promise<void> => { appended.push(e); return origAppend(e); };

        await s.edit('Note.md', noteBody('one', 'two EDITED', 'three'), 2000);

        const deltas = appended.filter(e => e.type === 'delta-apply');
        expect(deltas).toHaveLength(1);
        const d = deltas[0];
        expect(d.appliedIncrementally).toBe(true);
        expect(d.fallbackReason).toBeUndefined();
        expect(d.removed).toBeGreaterThan(0);            // the stale Bravo chunk
        expect(d.added).toBeGreaterThan(0);              // its replacement
        expect(d.metaPatches).toBeGreaterThanOrEqual(0);
        expect(d.applyDeltaMs).toBeGreaterThanOrEqual(0);
        expect(d.mutexHoldMs).toBeGreaterThan(0);
    });

    it('a second reconcile converges: nothing dirty, nothing embedded', async () => {
        const { s, embedded } = await bootWithNote(noteBody('one', 'two', 'three'));
        await s.edit('Note.md', noteBody('one', 'two EDITED', 'three'), 2000);
        embedded.length = 0;
        await s.reconcile();
        expect(embedded).toEqual([]);
    });

    it('an inline #tag in one section refreshes the OTHER sections\' stored tags without re-embedding them', async () => {
        const { s, embedded, infoSpy } = await bootWithNote(noteBody('one', 'two', 'three'));
        const before = new Map((await s.store.listAllMeta()).map(m => [m.chunk_id, m]));

        // The tag lives in Bravo's body (new id there), but metadata.tags is a
        // note-level union — every OTHER chunk's meta drifts while its id holds.
        await s.edit('Note.md', noteBody('one', 'two #hotnote', 'three'), 2000);

        expect(embedded.some(t => t.includes('hotnote'))).toBe(true);
        expect(embedded.some(t => t.includes('alpha0') && !t.includes('hotnote'))).toBe(false);
        expect(fallbackLogs(infoSpy)).toEqual([]);

        const rec = await s.store.getFileRecord('Note.md');
        const stableIds = rec!.chunk_ids.filter(id => before.has(id));
        expect(stableIds.length).toBeGreaterThan(0);
        const metas = await s.store.getChunkMetasByIds(stableIds);
        for (const id of stableIds) {
            expect(metas.get(id)?.metadata.tags).toContain('hotnote');   // refreshed in place
            expect(before.get(id)?.metadata.tags ?? []).not.toContain('hotnote');
        }
    });

    it('an edit that shifts later sections\' line numbers meta-patches them without re-embedding', async () => {
        const { s, embedded, infoSpy } = await bootWithNote(noteBody('one', 'two', 'three'));
        const before = new Map((await s.store.listAllMeta()).map(m => [m.chunk_id, m]));

        // Grow Alpha by a PARAGRAPH (new lines, not just new words): Bravo and
        // Charlie keep their content (stable ids) but move down the file.
        await s.edit('Note.md', noteBody('one\n\nGREW a whole new paragraph here', 'two', 'three'), 2000);

        expect(embedded.some(t => t.includes('GREW'))).toBe(true);
        expect(embedded.some(t => t.includes('bravo0') && !t.includes('GREW'))).toBe(false);
        expect(fallbackLogs(infoSpy)).toEqual([]);

        const rec = await s.store.getFileRecord('Note.md');
        const stableIds = rec!.chunk_ids.filter(id => before.has(id));
        expect(stableIds.length).toBeGreaterThan(0);
        const metas = await s.store.getChunkMetasByIds(stableIds);
        // At least one stable chunk actually moved, and the stored row tracked it.
        const moved = stableIds.filter(id => metas.get(id)!.start_line !== before.get(id)!.start_line);
        expect(moved.length).toBeGreaterThan(0);
    });

    it('an edit that empties the note drops every stale row (no ghosts)', async () => {
        const { s } = await bootWithNote(noteBody('one', 'two', 'three'));
        const noteIds = new Set((await s.store.getFileRecord('Note.md'))!.chunk_ids);
        // The chunker may still emit a title-only fallback chunk for an empty
        // note — the invariant under test is that NO pre-edit row survives and
        // nothing orphans, whatever the record ends up holding.
        await s.edit('Note.md', '', 3000);
        const rec = await s.store.getFileRecord('Note.md');
        const ballast = await s.store.getFileRecord('Ballast.md');
        const remaining = (await s.store.listAllMeta()).map(m => m.chunk_id);
        expect(remaining.some(id => noteIds.has(id))).toBe(false);   // no ghosts
        const referenced = new Set([...(rec?.chunk_ids ?? []), ...(ballast?.chunk_ids ?? [])]);
        expect(findOrphanChunkIds(remaining, referenced)).toEqual([]);
        expect(remaining.length).toBeGreaterThan(0);                  // ballast untouched
    });

    it('deleting the file removes everything and the delta still patches incrementally', async () => {
        const { s, infoSpy } = await bootWithNote(noteBody('one', 'two', 'three'));
        const noteIds = new Set((await s.store.getFileRecord('Note.md'))!.chunk_ids);
        await s.del('Note.md');
        expect(await s.store.getFileRecord('Note.md')).toBeFalsy();
        const remaining = (await s.store.listAllMeta()).map(m => m.chunk_id);
        expect(remaining.some(id => noteIds.has(id))).toBe(false);
        expect(fallbackLogs(infoSpy)).toEqual([]);
    });
});

describe('drift classifiers — the diff\'s three lanes', () => {
    const base = (): ChunkMeta => ({
        chunk_id: 'id1', title: 'Note > Alpha', note_path: 'Note.md',
        heading_path: ['Alpha'],
        metadata: { tags: ['projects'], aliases: [], created: '2026-07-01', modified: '2026-07-28', properties: { context: 'work' } },
        start_line: 10, end_line: 20,
    } as ChunkMeta);

    it('identical metas: untouched lane', () => {
        expect(chunkMetaEqual(base(), base())).toBe(true);
        expect(MultiFieldBM25.docFieldsEqual(base(), base())).toBe(true);
    });

    it('line/date drift: meta-patch lane (meta unequal, doc fields equal)', () => {
        for (const mutate of [
            (m: ChunkMeta) => { m.start_line = 15; m.end_line = 25; },
            (m: ChunkMeta) => { m.metadata.modified = '2026-07-30'; },
            (m: ChunkMeta) => { m.metadata.created = '2026-06-01'; },
        ]) {
            const b = base();
            mutate(b);
            expect(chunkMetaEqual(base(), b)).toBe(false);
            expect(MultiFieldBM25.docFieldsEqual(base(), b)).toBe(true);
        }
    });

    it('indexed-field drift: reindex-row lane (doc fields unequal)', () => {
        for (const mutate of [
            (m: ChunkMeta) => { m.metadata.tags = ['projects', 'hotnote']; },
            (m: ChunkMeta) => { m.metadata.properties = { context: 'personal' }; },
            (m: ChunkMeta) => { (m as { link_terms?: string }).link_terms = 'theverge.com'; },
            (m: ChunkMeta) => { m.metadata.aliases = ['Other Name']; },
            (m: ChunkMeta) => { m.heading_path = ['Renamed']; },
        ]) {
            const b = base();
            mutate(b);
            expect(MultiFieldBM25.docFieldsEqual(base(), b)).toBe(false);
        }
    });
});

describe('store primitives for the diff', () => {
    it('deleteChunksByIds removes exactly the given rows across all four chunk stores, record untouched', async () => {
        const s = new Scenario();
        open.push(s);
        await s.boot();
        s.vault.write('Note.md', noteBody('one', 'two', 'three'), 1000);
        await s.coldStart();
        const rec = await s.store.getFileRecord('Note.md');
        const victim = rec!.chunk_ids[0];
        await s.store.deleteChunksByIds([victim]);
        expect((await s.store.getChunkMetasByIds([victim])).size).toBe(0);
        expect((await s.store.getBodiesMap([victim])).size).toBe(0);
        // Record is the caller's responsibility — untouched by design.
        expect((await s.store.getFileRecord('Note.md'))!.chunk_ids).toContain(victim);
        // The other rows survive.
        const rest = rec!.chunk_ids.filter(id => id !== victim);
        expect((await s.store.getChunkMetasByIds(rest)).size).toBe(rest.length);
    });

    it('putChunkMetas refreshes the meta row, leaving the body byte-identical', async () => {
        const s = new Scenario();
        open.push(s);
        await s.boot();
        s.vault.write('Note.md', noteBody('one', 'two', 'three'), 1000);
        await s.coldStart();
        const rec = await s.store.getFileRecord('Note.md');
        const id = rec!.chunk_ids[0];
        const bodyBefore = (await s.store.getBodiesMap([id])).get(id);
        const meta = (await s.store.getChunkMetasByIds([id])).get(id)!;
        const patched = { ...meta, start_line: 999 };
        await s.store.putChunkMetas([patched]);
        expect((await s.store.getChunkMetasByIds([id])).get(id)?.start_line).toBe(999);
        expect((await s.store.getBodiesMap([id])).get(id)).toBe(bodyBefore);
    });
});
