// The ONE md/.base/.canvas gate (indexable-file.ts). Shared by the orchestrator's
// collection, the vault watcher and the settings-tab reindex total, so a wrong
// answer here desyncs writer and re-deriver.
import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { isIndexableFile, collectIndexableFiles, type IndexableGate } from './indexable-file';

function tf(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.extension = path.split('.').pop() ?? '';
    return f;
}

const ALL_ON: IndexableGate = { indexBases: true, indexCanvases: true };
const ALL_OFF: IndexableGate = { indexBases: false, indexCanvases: false };

describe('isIndexableFile', () => {
    it('always indexes markdown, regardless of the toggles', () => {
        expect(isIndexableFile(tf('a.md'), ALL_OFF)).toBe(true);
    });

    it('indexes .canvas only when indexCanvases is on', () => {
        expect(isIndexableFile(tf('board.canvas'), { indexBases: false, indexCanvases: true })).toBe(true);
        expect(isIndexableFile(tf('board.canvas'), { indexBases: true, indexCanvases: false })).toBe(false);
    });

    it('indexes .base only when indexBases is on', () => {
        expect(isIndexableFile(tf('q.base'), { indexBases: true, indexCanvases: false })).toBe(true);
        expect(isIndexableFile(tf('q.base'), { indexBases: false, indexCanvases: true })).toBe(false);
    });

    it('never indexes other extensions', () => {
        expect(isIndexableFile(tf('img.png'), ALL_ON)).toBe(false);
    });
});

describe('collectIndexableFiles', () => {
    const md = [tf('a.md'), tf('b.md')];
    const vault = {
        getMarkdownFiles: () => md,
        getFiles: () => [...md, tf('board.canvas'), tf('q.base'), tf('img.png')],
    };

    it('appends gated canvases and bases after the markdown notes', () => {
        expect(collectIndexableFiles(vault, ALL_ON).map(f => f.path)).toEqual(['a.md', 'b.md', 'board.canvas', 'q.base']);
    });

    it('respects each toggle independently', () => {
        expect(collectIndexableFiles(vault, { indexBases: false, indexCanvases: true }).map(f => f.path)).toEqual(['a.md', 'b.md', 'board.canvas']);
    });

    it('returns the markdown list itself when both toggles are off (no getFiles walk)', () => {
        const noWalk = { getMarkdownFiles: () => md, getFiles: (): TFile[] => { throw new Error('must not walk'); } };
        expect(collectIndexableFiles(noWalk, ALL_OFF)).toBe(md);
    });
});
