// ImageResultOpener (image-open.ts): the image open branch of the search modal.
// Invariant under test: SOMETHING always opens (never a throw past the click),
// and the best-effort scroll to the embed line can never leave the note on a
// wrong place. The leaf is a fake shaped like a MarkdownView's editor.
// The pure resolvers (referrersOf / embedLineFor) are tested Obsidian-free below.

import { describe, it, expect, vi } from 'vitest';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import {
    ImageResultOpener,
    referrersOf,
    embedLineFor,
    type ImageOpenTarget,
} from './image-open';

const image = { path: 'assets/Whiteboard.png', extension: 'png' } as unknown as TFile;
const note = { path: 'Notes/Plan.md', extension: 'md' } as unknown as TFile;

// A leaf whose `view.editor` is whatever the test hands in (undefined = a view
// without an editor, e.g. preview mode or a not-yet-ready view).
function fakeLeaf(editor: unknown) {
    const openFile = vi.fn(async () => {});
    const leaf = { view: { editor }, openFile } as unknown as WorkspaceLeaf;
    return { leaf, openFile };
}

function fakeEditor(overrides: Partial<{ setCursor: () => void; scrollIntoView: () => void }> = {}) {
    return { setCursor: vi.fn(), scrollIntoView: vi.fn(), ...overrides };
}

function opener() {
    const reportFailure = vi.fn();
    return { opener: new ImageResultOpener({ reportFailure }), reportFailure };
}

describe('ImageResultOpener', () => {
    it('image target (0 or several referrers): opens the image file itself', async () => {
        const { leaf, openFile } = fakeLeaf(fakeEditor());
        const target: ImageOpenTarget = { kind: 'image' };

        const outcome = await opener().opener.open(leaf, image, target, true);

        expect(outcome).toBe('opened-image');
        expect(openFile).toHaveBeenCalledWith(image, { active: true });
    });

    it('note target with a line: opens the note and scrolls to the embed line', async () => {
        const editor = fakeEditor();
        const { leaf, openFile } = fakeLeaf(editor);
        const target: ImageOpenTarget = { kind: 'note', note, line: 12 };

        const outcome = await opener().opener.open(leaf, image, target, false);

        expect(outcome).toBe('opened-note');
        expect(openFile).toHaveBeenCalledWith(note, { active: false });
        expect(editor.setCursor).toHaveBeenCalledWith({ line: 12, ch: 0 });
        expect(editor.scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('note target without a line: opens the note, no scroll', async () => {
        const editor = fakeEditor();
        const { leaf, openFile } = fakeLeaf(editor);
        const target: ImageOpenTarget = { kind: 'note', note, line: null };

        const outcome = await opener().opener.open(leaf, image, target, false);

        expect(outcome).toBe('opened-note-top');
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(editor.setCursor).not.toHaveBeenCalled();
    });

    it('note target but the view has no editor (preview mode): note opens, no scroll', async () => {
        const { leaf, openFile } = fakeLeaf(undefined);
        const o = opener();
        const target: ImageOpenTarget = { kind: 'note', note, line: 3 };

        const outcome = await o.opener.open(leaf, image, target, false);

        expect(outcome).toBe('opened-note-top');
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(o.reportFailure).not.toHaveBeenCalled();
    });

    it('scroll throws: the click survives, ONE diagnostics line, note stays open', async () => {
        const editor = fakeEditor({ scrollIntoView: vi.fn(() => { throw new Error('editor gone'); }) });
        const { leaf, openFile } = fakeLeaf(editor);
        const o = opener();
        const target: ImageOpenTarget = { kind: 'note', note, line: 5 };

        const outcome = await o.opener.open(leaf, image, target, false);

        expect(outcome).toBe('scroll-failed');
        expect(openFile).toHaveBeenCalledTimes(1);
        expect(o.reportFailure).toHaveBeenCalledTimes(1);
        expect(o.reportFailure).toHaveBeenCalledWith('image-embed-scroll', expect.any(Error));
    });
});

describe('referrersOf', () => {
    it('returns every source note whose resolvedLinks include the exact image path', () => {
        const links = {
            'a.md': { 'assets/Whiteboard.png': 1, 'other.md': 2 },
            'b.md': { 'assets/Whiteboard.png': 1 },
            'c.md': { 'assets/Other.png': 1 },
        };
        expect(referrersOf('assets/Whiteboard.png', links).sort()).toEqual(['a.md', 'b.md']);
    });

    it('matches the resolved full path only, never a bare basename', () => {
        const links = { 'a.md': { 'other/Whiteboard.png': 1 } };
        expect(referrersOf('assets/Whiteboard.png', links)).toEqual([]);
    });

    it('empty when nothing references the image', () => {
        expect(referrersOf('assets/x.png', { 'a.md': { 'y.md': 1 } })).toEqual([]);
    });
});

describe('embedLineFor', () => {
    const IMG = 'assets/Whiteboard.png';

    it('wiki embed by short basename', () => {
        const text = ['# Plan', '', 'See ![[Whiteboard.png]] below.'].join('\n');
        expect(embedLineFor(text, IMG)).toBe(2);
    });

    it('wiki embed by full vault path', () => {
        const text = ['intro', '![[assets/Whiteboard.png]]'].join('\n');
        expect(embedLineFor(text, IMG)).toBe(1);
    });

    it('wiki embed with an alias/size suffix', () => {
        const text = ['![[Whiteboard.png|A caption]]'].join('\n');
        expect(embedLineFor(text, IMG)).toBe(0);
        expect(embedLineFor('![[Whiteboard.png|300]]', IMG)).toBe(0);
    });

    it('markdown embed by path', () => {
        const text = ['line0', 'line1', '![alt](assets/Whiteboard.png)'].join('\n');
        expect(embedLineFor(text, IMG)).toBe(2);
    });

    it('markdown embed with percent-encoded spaces', () => {
        const img = 'assets/White board.png';
        const text = ['![](assets/White%20board.png)'].join('\n');
        expect(embedLineFor(text, img)).toBe(0);
    });

    it('markdown embed with an angle-bracketed path and a title', () => {
        const img = 'assets/White board.png';
        expect(embedLineFor('![](<assets/White board.png> "cap")', img)).toBe(0);
        expect(embedLineFor('![](assets/Whiteboard.png "cap")', IMG)).toBe(0);
    });

    it('returns null when no line embeds the image', () => {
        const text = ['just prose', 'a [[Whiteboard.png]] plain link (not an embed)'].join('\n');
        expect(embedLineFor(text, IMG)).toBeNull();
    });

    it('finds the FIRST embedding line when several embed it', () => {
        const text = ['![[Whiteboard.png]]', 'middle', '![[Whiteboard.png]]'].join('\n');
        expect(embedLineFor(text, IMG)).toBe(0);
    });
});
