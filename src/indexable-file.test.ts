// The ONE md/.base/.canvas/image gate (indexable-file.ts). Shared by the
// orchestrator's collection, the vault watcher and the settings-tab reindex
// total, so a wrong answer here desyncs writer and re-deriver.
import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { isIndexableFile, collectIndexableFiles, type IndexableGate } from './indexable-file';

function tf(path: string): TFile {
    const f = new TFile();
    f.path = path;
    f.extension = path.split('.').pop() ?? '';
    return f;
}

// Gates default every toggle OFF; each test flips only what it exercises.
function gate(over: Partial<IndexableGate> = {}): IndexableGate {
    return { indexBases: false, indexCanvases: false, indexImages: false, ...over };
}

const ALL_ON: IndexableGate = gate({ indexBases: true, indexCanvases: true, indexImages: true });
const ALL_OFF: IndexableGate = gate();

describe('isIndexableFile', () => {
    it('always indexes markdown, regardless of the toggles', () => {
        expect(isIndexableFile(tf('a.md'), ALL_OFF)).toBe(true);
    });

    it('indexes .canvas only when indexCanvases is on', () => {
        expect(isIndexableFile(tf('board.canvas'), gate({ indexCanvases: true }))).toBe(true);
        expect(isIndexableFile(tf('board.canvas'), gate({ indexBases: true }))).toBe(false);
    });

    it('indexes .base only when indexBases is on', () => {
        expect(isIndexableFile(tf('q.base'), gate({ indexBases: true }))).toBe(true);
        expect(isIndexableFile(tf('q.base'), gate({ indexCanvases: true }))).toBe(false);
    });

    it('indexes a raster image only when indexImages is on', () => {
        expect(isIndexableFile(tf('shot.png'), gate({ indexImages: true }))).toBe(true);
        expect(isIndexableFile(tf('shot.png'), gate({ indexCanvases: true }))).toBe(false);
    });

    it('never indexes svg / heic even with indexImages on (counted separately for the status card)', () => {
        expect(isIndexableFile(tf('diagram.svg'), ALL_ON)).toBe(false);
        expect(isIndexableFile(tf('photo.heic'), ALL_ON)).toBe(false);
    });

    it('never indexes an unrelated extension', () => {
        expect(isIndexableFile(tf('data.json'), ALL_ON)).toBe(false);
    });
});

describe('collectIndexableFiles', () => {
    const md = [tf('a.md'), tf('b.md')];
    const vault = {
        getMarkdownFiles: () => md,
        getFiles: () => [...md, tf('board.canvas'), tf('q.base'), tf('shot.png')],
    };

    it('appends gated canvases, bases and images after the markdown notes', () => {
        expect(collectIndexableFiles(vault, ALL_ON).map(f => f.path)).toEqual(['a.md', 'b.md', 'board.canvas', 'q.base', 'shot.png']);
    });

    it('respects each toggle independently', () => {
        expect(collectIndexableFiles(vault, gate({ indexCanvases: true })).map(f => f.path)).toEqual(['a.md', 'b.md', 'board.canvas']);
    });

    it('includes images when only indexImages is on', () => {
        expect(collectIndexableFiles(vault, gate({ indexImages: true })).map(f => f.path)).toEqual(['a.md', 'b.md', 'shot.png']);
    });

    it('returns the markdown list itself when every toggle is off (no getFiles walk)', () => {
        const noWalk = { getMarkdownFiles: () => md, getFiles: (): TFile[] => { throw new Error('must not walk'); } };
        expect(collectIndexableFiles(noWalk, ALL_OFF)).toBe(md);
    });
});
