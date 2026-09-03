// FakeVault — an in-memory path→{content,mtime} map standing in for Obsidian's
// Vault. This is the ENTIRE Obsidian surface the index path reads (search.ts
// touches exactly: getMarkdownFiles / getFiles / getAbstractFileByPath /
// cachedRead / readBinary / adapter (sidecar + OCR cache)).
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
interface VImage { bytes: Uint8Array; mtime: number; }

// A minimal in-memory DataAdapter — enough for the OCR cache (read/write/exists/
// list/remove/mkdir/stat) and the sidecar. Off by default in scenarios (they
// pass no indexDir), used only when a scenario opts into an index dir.
export class FakeAdapter {
    files = new Map<string, string>();
    binaries = new Map<string, ArrayBuffer>();
    dirs = new Set<string>();

    async read(path: string): Promise<string> {
        const v = this.files.get(path);
        if (v === undefined) throw new Error(`ENOENT ${path}`);
        return v;
    }
    async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
    async writeBinary(path: string, data: ArrayBuffer): Promise<void> { this.binaries.set(path, data); }
    async readBinary(path: string): Promise<ArrayBuffer> {
        const v = this.binaries.get(path);
        if (v === undefined) throw new Error(`ENOENT ${path}`);
        return v;
    }
    async exists(path: string): Promise<boolean> { return this.files.has(path) || this.binaries.has(path) || this.dirs.has(path); }
    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const prefix = `${path}/`;
        const under = (m: Map<string, unknown>): string[] =>
            [...m.keys()].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
        return { files: [...under(this.files), ...under(this.binaries)], folders: [] };
    }
    async remove(path: string): Promise<void> { this.files.delete(path); this.binaries.delete(path); }
    async mkdir(path: string): Promise<void> { this.dirs.add(path); }
    async rmdir(path: string): Promise<void> { this.dirs.delete(path); }
    async stat(path: string): Promise<{ size: number; type: 'file' } | null> {
        const t = this.files.get(path);
        if (t !== undefined) return { size: t.length, type: 'file' };
        const b = this.binaries.get(path);
        if (b !== undefined) return { size: b.byteLength, type: 'file' };
        return null;
    }
    async rename(from: string, to: string): Promise<void> {
        if (this.files.has(from)) { this.files.set(to, this.files.get(from)!); this.files.delete(from); }
        if (this.binaries.has(from)) { this.binaries.set(to, this.binaries.get(from)!); this.binaries.delete(from); }
    }
}

export class FakeVault {
    private files = new Map<string, VFile>();
    private images = new Map<string, VImage>();
    // Paths whose cachedRead / readBinary throws — models a file deleted/evicted
    // BETWEEN the directory listing and the read (the carryover NotFoundError
    // family: the embed pass must skip just that file, not abort the whole batch).
    failReads = new Set<string>();
    // How many times readBinary was called — the no-re-read oracle asserts 0 over
    // an unchanged-image sweep (docs/research/image-ocr.md §4).
    readBinaryCalls = 0;
    adapter = new FakeAdapter();

    // Driver mutators — each is the data-residue of one Obsidian Vault event:
    write(path: string, content: string, mtime: number): void { this.files.set(path, { content, mtime }); }
    // A raster image: bytes + mtime (its content hash is sha256 of the bytes).
    writeImage(path: string, bytes: Uint8Array, mtime: number): void { this.images.set(path, { bytes, mtime }); }
    touch(path: string, mtime: number): void {
        const f = this.files.get(path); if (f) f.mtime = mtime;
        const im = this.images.get(path); if (im) im.mtime = mtime;   // iCloud re-stamp
    }
    remove(path: string): void { this.files.delete(path); this.images.delete(path); }

    getMarkdownFiles(): TFile[] { return [...this.files].filter(([p]) => p.endsWith('.md')).map(([p, f]) => this.tf(p, f.mtime, f.content.length)); }
    getFiles(): TFile[] {
        return [
            ...[...this.files].map(([p, f]) => this.tf(p, f.mtime, f.content.length)),
            ...[...this.images].map(([p, im]) => this.tf(p, im.mtime, im.bytes.byteLength)),
        ];
    }
    getAbstractFileByPath(path: string): TFile | null {
        const f = this.files.get(path);
        if (f) return this.tf(path, f.mtime, f.content.length);
        const im = this.images.get(path);
        return im ? this.tf(path, im.mtime, im.bytes.byteLength) : null;
    }
    async cachedRead(file: TFile): Promise<string> {
        if (this.failReads.has(file.path)) throw this.notFound(file.path);
        const f = this.files.get(file.path);
        if (!f) throw new Error(`cachedRead: ${file.path} not in vault`);
        return f.content;
    }
    async readBinary(file: TFile): Promise<ArrayBuffer> {
        this.readBinaryCalls++;
        if (this.failReads.has(file.path)) throw this.notFound(file.path);
        const im = this.images.get(file.path);
        if (!im) throw new Error(`readBinary: ${file.path} not in vault`);
        return im.bytes.buffer.slice(im.bytes.byteOffset, im.bytes.byteOffset + im.bytes.byteLength) as ArrayBuffer;
    }

    private notFound(path: string): Error {
        const e = new Error(`ENOENT: ${path}`); (e as { name: string }).name = 'NotFoundError'; return e;
    }
    private tf(path: string, mtime: number, size: number): TFile {
        const t = new TFile();
        t.path = path;
        t.stat = { mtime, ctime: mtime, size };
        t.extension = path.split('.').pop() ?? '';   // the .base / .canvas / image gate in indexable-file.ts
        return t;
    }
}
