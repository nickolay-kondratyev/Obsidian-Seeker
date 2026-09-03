// Cross-module scenario: a `.canvas` file rides the REAL index pipeline
// (collect → chunksFor → chunkCanvas → embed → store) through the tier-2 harness.
// Pins the three wiring facts of docs/canvas-search-plan.md §3c that no unit
// test can see: chunksFor routes `.canvas` to chunkCanvas, the indexCanvases
// setting gates collection, and a drag/resize (geometry-only rewrite) costs no
// embed and produces an EMPTY change-set.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Scenario } from './test-harness/scenario';
import type { SeekerSettings } from './types';

const LONG_CARD = 'A long card about the migration of monarch butterflies across the continent, '
    + 'which travel thousands of kilometres every autumn to overwinter in the mountain forests.';

function canvasJson(cardX: number, cardWidth: number): string {
    return JSON.stringify({
        nodes: [
            { id: 'g1', type: 'group', label: 'Research', x: 0, y: 0, width: 1000, height: 1000 },
            { id: 'n1', type: 'text', text: LONG_CARD, x: cardX, y: 10, width: cardWidth, height: 200 },
            { id: 'n2', type: 'text', text: 'short card', x: 10, y: 300, width: 200, height: 60 },
            { id: 'f1', type: 'file', file: 'Notes/Butterflies.md', x: 10, y: 400, width: 200, height: 60 },
        ],
        edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2', label: 'leads to' }],
    });
}

describe('canvas indexing wiring (search.ts chunksFor + indexCanvases gate)', () => {
    let active: Scenario | null = null;
    const boot = async (settings: Partial<SeekerSettings> = {}): Promise<Scenario> => {
        const s = new Scenario();
        await s.boot(settings);
        active = s;
        return s;
    };
    afterEach(async () => { await active?.teardown(); active = null; });

    it('chunksFor routes .canvas through chunkCanvas: a map chunk plus a long-card chunk carrying its node id', async () => {
        const s = await boot();
        s.vault.write('Boards/Roadmap.canvas', canvasJson(10, 400), 1000);
        await s.coldStart();

        const rows = (await s.store.listAllMeta()).filter(m => m.note_path === 'Boards/Roadmap.canvas');
        expect(rows.map(m => m.canvas_node_id ?? null).sort()).toEqual(['n1', null]);   // [map chunk, long card n1]
    });

    it('the map chunk carries the group label in heading_path (synthetic markdown reached the chunker)', async () => {
        const s = await boot();
        s.vault.write('Boards/Roadmap.canvas', canvasJson(10, 400), 1000);
        await s.coldStart();

        const rows = await s.store.listAllMeta();
        expect(rows.some(m => m.heading_path.includes('Research'))).toBe(true);
    });

    it('indexCanvases OFF excludes .canvas from collection while markdown still indexes', async () => {
        const s = await boot({ indexCanvases: false });
        s.vault.write('Boards/Roadmap.canvas', canvasJson(10, 400), 1000);
        s.vault.write('note.md', 'a plain note about pottery glazes', 1000);
        await s.coldStart();

        const paths = new Set((await s.store.listFileRecords()).map(r => r.note_path));
        expect([...paths]).toEqual(['note.md']);
    });

    it('drag/resize (x/width only) re-derives identical chunk ids: no embed, empty change-set, mtime advances', async () => {
        const s = await boot();
        s.vault.write('Boards/Roadmap.canvas', canvasJson(10, 400), 1000);
        await s.coldStart();
        const idsBefore = (await s.store.getAllChunkIds()).sort();

        const spy = vi.spyOn(s.embedder, 'embedBatch');
        s.logEntries.length = 0;
        await s.edit('Boards/Roadmap.canvas', canvasJson(250, 640), 2000);   // bytes DO change → classifyFileDelta says dirty

        expect(spy).not.toHaveBeenCalled();
        expect((await s.store.getAllChunkIds()).sort()).toEqual(idsBefore);
        const applied = s.logEntries.filter(e => e.type === 'delta-apply');
        expect(applied.map(e => ({ added: e.added, removed: e.removed }))).toEqual([{ added: 0, removed: 0 }]);
        expect((await s.store.getFileRecord('Boards/Roadmap.canvas'))?.mtimeMs).toBe(2000);
    });
});
