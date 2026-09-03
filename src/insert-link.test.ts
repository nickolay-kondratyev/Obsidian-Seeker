import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
    buildNoteLink,
    headingSubpath,
    isInsertableFile,
    resolveInsertLinkAlias,
    resolveInsertLinkSubpath,
} from './insert-link';

describe('headingSubpath', () => {
    it('returns undefined for empty paths', () => {
        expect(headingSubpath([])).toBeUndefined();
        expect(headingSubpath(null)).toBeUndefined();
        expect(headingSubpath(undefined)).toBeUndefined();
    });

    it('uses the last heading segment', () => {
        expect(headingSubpath(['Agenda', 'Intern pgm'])).toBe('#Intern pgm');
        expect(headingSubpath(['Only'])).toBe('#Only');
    });
});

describe('resolveInsertLinkSubpath', () => {
    const sectionPath = ['Agenda', 'Intern pgm'];
    const note = { extension: 'md', basename: 'Weekly Sync' };

    it('links the matched section for a normal chunk-jump result', () => {
        expect(resolveInsertLinkSubpath(note, sectionPath, false)).toBe('#Intern pgm');
    });

    it('links the bare note for a title-nav result, even with a section hit', () => {
        expect(resolveInsertLinkSubpath(note, sectionPath, true)).toBe('');
    });

    it('links the bare note when the result has no heading', () => {
        expect(resolveInsertLinkSubpath(note, [], false)).toBe('');
        expect(resolveInsertLinkSubpath(note, null, false)).toBe('');
    });

    it('drops a lone heading that duplicates the note title (case-insensitive)', () => {
        expect(resolveInsertLinkSubpath(note, ['Weekly Sync'], false)).toBe('');
        expect(resolveInsertLinkSubpath(note, ['weekly sync'], false)).toBe('');
        expect(resolveInsertLinkSubpath(note, [' Weekly Sync '], false)).toBe('');
    });

    it('keeps a lone heading that differs from the note title', () => {
        expect(resolveInsertLinkSubpath(note, ['Agenda'], false)).toBe('#Agenda');
    });

    it('keeps a nested last segment even when it matches the note title', () => {
        expect(resolveInsertLinkSubpath(note, ['Intro', 'Weekly Sync'], false)).toBe('#Weekly Sync');
    });

    it('never gives a .canvas result a subpath — its heading_path is a group chain, not a heading', () => {
        const canvas = { extension: 'canvas', basename: 'Roadmap' };
        expect(resolveInsertLinkSubpath(canvas, ['Q3', 'Platform'], false)).toBe('');
    });
});

describe('resolveInsertLinkAlias', () => {
    it('returns trimmed explicit alias for CLI', () => {
        expect(resolveInsertLinkAlias('  cli alias  ')).toBe('cli alias');
    });

    it('returns undefined when no explicit alias', () => {
        expect(resolveInsertLinkAlias(undefined)).toBeUndefined();
        expect(resolveInsertLinkAlias('')).toBeUndefined();
        expect(resolveInsertLinkAlias('   ')).toBeUndefined();
    });
});

describe('buildNoteLink', () => {
    const file = { path: 'folder/Note Title.md', extension: 'md' } as TFile;

    it('uses generateMarkdownLink when active file exists', () => {
        const app = {
            workspace: { getActiveFile: () => ({ path: 'Daily.md' }) },
            fileManager: {
                generateMarkdownLink: (
                    f: TFile,
                    source: string,
                    subpath: string,
                    alias: string,
                ) => `LINK:${f.path}:${source}:${subpath}:${alias}`,
            },
        } as unknown as App;

        expect(buildNoteLink(app, file, { subpath: '#Sec', alias: 'alias' }))
            .toBe('LINK:folder/Note Title.md:Daily.md:#Sec:alias');
    });

    it('falls back to wikilink syntax without active file', () => {
        const app = {
            workspace: { getActiveFile: () => null },
            fileManager: { generateMarkdownLink: () => 'unused' },
        } as unknown as App;

        expect(buildNoteLink(app, file)).toBe('[[Note Title]]');
        expect(buildNoteLink(app, file, { subpath: '#H', alias: 'test' }))
            .toBe('[[Note Title#H|test]]');
    });

    it('keeps the .canvas extension in the no-active-file fallback (Obsidian needs [[x.canvas]])', () => {
        const app = {
            workspace: { getActiveFile: () => null },
            fileManager: { generateMarkdownLink: () => 'unused' },
        } as unknown as App;
        const canvas = { path: 'maps/Roadmap.canvas', extension: 'canvas' } as TFile;

        expect(buildNoteLink(app, canvas)).toBe('[[Roadmap.canvas]]');
    });
});

describe('isInsertableFile', () => {
    it('accepts notes and canvases, rejects bases and null', () => {
        expect(isInsertableFile({ extension: 'md' } as TFile)).toBe(true);
        expect(isInsertableFile({ extension: 'canvas' } as TFile)).toBe(true);
        expect(isInsertableFile({ extension: 'base' } as TFile)).toBe(false);
        expect(isInsertableFile(null)).toBe(false);
    });
});
