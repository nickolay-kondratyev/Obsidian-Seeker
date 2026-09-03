// FakeVault — an in-memory path→{content,mtime} map standing in for Obsidian's
// Vault. This is the ENTIRE Obsidian surface the index path reads (search.ts
// touches exactly: getMarkdownFiles / getFiles / getAbstractFileByPath /
// cachedRead / adapter (sidecar only, off here)).
//
// Lives in its own module — deliberately free of fake-indexeddb and of any
// Node-only import — because it is shared by two very different hosts:
//   • scenario.ts (vitest, Node): re-exports it; the harness there ALSO imports
//     'fake-indexeddb/auto' to get an IndexedDB global.
//   • bench/harness/page.ts (real Chromium): must NOT pull fake-indexeddb in,
//     since that module REPLACES the browser's real IndexedDB on import and the
//     bench exists to measure the real one.
// `TFile` resolves to the test-stub class in both hosts (vitest alias /
// esbuild alias), so `instanceof TFile` in search.ts holds.
import { TFile } from 'obsidian';

interface VFile { content: string; mtime: number; }

export class FakeVault {
    private files = new Map<string, VFile>();
    // Paths whose cachedRead throws — models a file deleted/evicted BETWEEN the
    // directory listing and the read (the carryover NotFoundError family: the
    // embed pass must skip just that file, not abort the whole batch).
    failReads = new Set<string>();

    // Driver mutators — each is the data-residue of one Obsidian Vault event:
    write(path: string, content: string, mtime: number): void { this.files.set(path, { content, mtime }); }
    touch(path: string, mtime: number): void { const f = this.files.get(path); if (f) f.mtime = mtime; } // iCloud re-stamp
    remove(path: string): void { this.files.delete(path); }

    getMarkdownFiles(): TFile[] { return this.list(p => p.endsWith('.md')); }
    getFiles(): TFile[] { return this.list(() => true); }
    getAbstractFileByPath(path: string): TFile | null {
        const f = this.files.get(path);
        return f ? this.tf(path, f) : null;
    }
    async cachedRead(file: TFile): Promise<string> {
        if (this.failReads.has(file.path)) {
            const e = new Error(`ENOENT: ${file.path}`); (e as { name: string }).name = 'NotFoundError'; throw e;
        }
        const f = this.files.get(file.path);
        if (!f) throw new Error(`cachedRead: ${file.path} not in vault`);
        return f.content;
    }
    // clearDevice / forensics reach for the adapter; sidecarOn() is false in
    // scenarios (indexDir=null), so the index path never dereferences it.
    adapter = {} as never;

    private list(pred: (p: string) => boolean): TFile[] {
        return [...this.files].filter(([p]) => pred(p)).map(([p, f]) => this.tf(p, f));
    }
    private tf(path: string, f: VFile): TFile {
        const t = new TFile();
        t.path = path;
        t.stat = { mtime: f.mtime, ctime: f.mtime, size: f.content.length };
        t.extension = path.split('.').pop() ?? '';   // the .base / .canvas gate in indexable-file.ts
        return t;
    }
}
