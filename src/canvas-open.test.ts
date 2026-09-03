// CanvasResultOpener (canvas-open.ts): the `.canvas` open branch of the search
// modal. Invariant under test: the canvas ALWAYS opens, and the best-effort
// zoom-to-node can never throw past the click, never land on a wrong node.
// The leaf is a fake shaped like the undocumented CanvasView internals.

import { describe, it, expect, vi } from 'vitest';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import { CanvasResultOpener } from './canvas-open';

const NODE_ID = 'node-abc';
const file = { path: 'Roadmap.canvas', extension: 'canvas' } as unknown as TFile;

interface FakeCanvas {
    nodes: { get: (id: string) => unknown };
    selectOnly: (node: unknown) => void;
    zoomToSelection: () => void;
}

// A leaf whose `view.canvas` is whatever the test hands in (undefined = a view
// without the internals, e.g. Obsidian changed them).
function fakeLeaf(canvas: unknown) {
    const openFile = vi.fn(async () => {});
    const leaf = { view: { canvas }, openFile } as unknown as WorkspaceLeaf;
    return { leaf, openFile };
}

function fakeCanvas(nodeById: Record<string, unknown>, overrides: Partial<FakeCanvas> = {}): FakeCanvas {
    return {
        nodes: { get: (id: string) => nodeById[id] },
        selectOnly: vi.fn(),
        zoomToSelection: vi.fn(),
        ...overrides,
    };
}

function opener() {
    const reportFailure = vi.fn();
    const nextFrame = vi.fn((cb: () => void) => cb());
    return { opener: new CanvasResultOpener({ reportFailure, nextFrame }), reportFailure, nextFrame };
}

describe('CanvasResultOpener', () => {
    it('map chunk (no node id): opens the canvas and touches nothing else', async () => {
        const canvas = fakeCanvas({ [NODE_ID]: {} });
        const { leaf, openFile } = fakeLeaf(canvas);

        const outcome = await opener().opener.open(leaf, file, undefined, true);

        expect(outcome).toBe('opened');
        expect(openFile).toHaveBeenCalledWith(file, { active: true, eState: undefined });
        expect(canvas.selectOnly).not.toHaveBeenCalled();
    });

    it('node found: selects + zooms to that exact node after opening', async () => {
        const node = { id: NODE_ID };
        const canvas = fakeCanvas({ [NODE_ID]: node });
        const { leaf, openFile } = fakeLeaf(canvas);

        const outcome = await opener().opener.open(leaf, file, NODE_ID, false);

        expect(outcome).toBe('focused');
        expect(openFile).toHaveBeenCalledWith(file, { active: false, eState: { match: { nodeId: NODE_ID } } });
        expect(canvas.selectOnly).toHaveBeenCalledWith(node);
        expect(canvas.zoomToSelection).toHaveBeenCalledTimes(1);
    });

    it('canvas internals missing on the view: opened, no failure reported', async () => {
        const { leaf, openFile } = fakeLeaf(undefined);
        const o = opener();

        const outcome = await o.opener.open(leaf, file, NODE_ID, true);

        expect(outcome).toBe('no-api');
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(o.reportFailure).not.toHaveBeenCalled();
    });

    it('partial internals (no selectOnly): treated as no API, never called', async () => {
        const canvas = fakeCanvas({ [NODE_ID]: {} }, { selectOnly: undefined as unknown as FakeCanvas['selectOnly'] });
        const { leaf } = fakeLeaf(canvas);

        expect(await opener().opener.open(leaf, file, NODE_ID, true)).toBe('no-api');
        expect(canvas.zoomToSelection).not.toHaveBeenCalled();
    });

    it('node deleted since indexing: opened, one rAF retry, then gives up silently', async () => {
        const canvas = fakeCanvas({});
        const { leaf } = fakeLeaf(canvas);
        const o = opener();

        const outcome = await o.opener.open(leaf, file, NODE_ID, true);

        expect(outcome).toBe('node-missing');
        expect(o.nextFrame).toHaveBeenCalledTimes(1);
        expect(canvas.selectOnly).not.toHaveBeenCalled();
        expect(o.reportFailure).not.toHaveBeenCalled();
    });

    it('nodes not ready until the next frame: the single retry finds the node', async () => {
        const node = { id: NODE_ID };
        const byId: Record<string, unknown> = {};
        const canvas = fakeCanvas(byId);
        const { leaf } = fakeLeaf(canvas);
        const o = opener();
        o.nextFrame.mockImplementation((cb: () => void) => { byId[NODE_ID] = node; cb(); });

        expect(await o.opener.open(leaf, file, NODE_ID, true)).toBe('focused');
        expect(canvas.selectOnly).toHaveBeenCalledWith(node);
    });

    it('selectOnly throws: the click survives, ONE diagnostics line, canvas stays open', async () => {
        const canvas = fakeCanvas({ [NODE_ID]: {} }, {
            selectOnly: vi.fn(() => { throw new Error('internals changed'); }),
        });
        const { leaf, openFile } = fakeLeaf(canvas);
        const o = opener();

        const outcome = await o.opener.open(leaf, file, NODE_ID, true);

        expect(outcome).toBe('focus-failed');
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(o.reportFailure).toHaveBeenCalledTimes(1);
        expect(o.reportFailure).toHaveBeenCalledWith('canvas-zoom-to-node', expect.any(Error));
    });

    it('nodes.get throws: same — survives with one diagnostics line', async () => {
        const canvas = fakeCanvas({}, { nodes: { get: () => { throw new Error('boom'); } } });
        const { leaf } = fakeLeaf(canvas);
        const o = opener();

        expect(await o.opener.open(leaf, file, NODE_ID, true)).toBe('focus-failed');
        expect(o.reportFailure).toHaveBeenCalledWith('canvas-node-lookup', expect.any(Error));
        expect(canvas.selectOnly).not.toHaveBeenCalled();
    });
});
