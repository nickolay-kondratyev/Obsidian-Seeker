// The per-producer open-history store (open-history.ts): stamping, persistence,
// rename carry-over, bounded rewrite, torn-line/crash recovery, append failure.
import { describe, it, expect, beforeEach } from 'vitest';
import type { DataAdapter } from 'obsidian';
import {
    OpenHistoryStore,
    openHistoryPathFor,
    parseOpenHistory,
    FLUSH_BATCH_WINDOW_MS,
    REWRITE_AFTER_APPENDED_LINES,
    type OpenHistoryAdapter,
    type OpenHistoryTimers,
} from './open-history';
import { deviceIdFromArtifactPath, sidecarDirSignature, type SidecarSelf } from './sidecar';

// In-memory adapter; directories are implicit (a dir exists if a file lives under it).
class MemAdapter implements OpenHistoryAdapter {
    files = new Map<string, string>();
    failAppends = 0;   // next N append() calls throw (iOS iCloud contention)
    failReads = 0;     // next N read() calls throw
    failRenames = 0;   // next N rename() calls throw
    async exists(p: string): Promise<boolean> {
        if (this.files.has(p)) return true;
        for (const k of this.files.keys()) if (k.startsWith(`${p}/`)) return true;
        return false;
    }
    async mkdir(_p: string): Promise<void> { /* implicit */ }
    async read(p: string): Promise<string> {
        if (this.failReads > 0) { this.failReads--; throw new Error('read failed'); }
        const v = this.files.get(p);
        if (v === undefined) throw new Error(`ENOENT ${p}`);
        return v;
    }
    async write(p: string, data: string): Promise<void> { this.files.set(p, data); }
    async append(p: string, data: string): Promise<void> {
        if (this.failAppends > 0) { this.failAppends--; throw new Error('append failed'); }
        this.files.set(p, (this.files.get(p) ?? '') + data);
    }
    async rename(from: string, to: string): Promise<void> {
        if (this.failRenames > 0) { this.failRenames--; throw new Error('rename failed'); }
        const v = this.files.get(from);
        if (v === undefined) throw new Error(`ENOENT ${from}`);
        this.files.set(to, v);
        this.files.delete(from);
    }
    async remove(p: string): Promise<void> { this.files.delete(p); }
    async list(dir: string): Promise<{ folders: string[]; files: string[] }> {
        const prefix = `${dir}/`;
        const folders = new Set<string>();
        const files: string[] = [];
        for (const p of this.files.keys()) {
            if (!p.startsWith(prefix)) continue;
            const rest = p.slice(prefix.length);
            const slash = rest.indexOf('/');
            if (slash >= 0) folders.add(prefix + rest.slice(0, slash));
            else files.push(p);
        }
        return { folders: [...folders], files };
    }
    async stat(p: string): Promise<{ size: number; mtime: number; type: 'file' } | null> {
        const v = this.files.get(p);
        return v === undefined ? null : { size: v.length, mtime: 1, type: 'file' };
    }
}

// Manual timers: nothing fires until the test says so.
class ManualTimers implements OpenHistoryTimers {
    private next = 1;
    pending = new Map<number, { fn: () => void; ms: number }>();
    setTimeout(fn: () => void, ms: number): number {
        const h = this.next++;
        this.pending.set(h, { fn, ms });
        return h;
    }
    clearTimeout(h: number): void { this.pending.delete(h); }
    fireAll(): void {
        const due = [...this.pending.values()];
        this.pending.clear();
        for (const t of due) t.fn();
    }
}

const DIR = '.obsidian/plugins/seeker/index';
const SELF: SidecarSelf = { deviceId: 'desktop-2b7e54aa', producerId: 'desktop-2b7e54aa-07d2e6a1' };
const FILE = openHistoryPathFor(DIR, SELF.producerId);
const T0 = 1_700_000_000_000;

interface Rig { adapter: MemAdapter; timers: ManualTimers; clock: { ms: number }; errors: string[] }

function rig(adapter = new MemAdapter()): Rig {
    return { adapter, timers: new ManualTimers(), clock: { ms: T0 }, errors: [] };
}

function storeOn(r: Rig): OpenHistoryStore {
    return new OpenHistoryStore(r.adapter, DIR, SELF, {
        now: () => r.clock.ms,
        timers: r.timers,
        onError: (ctx) => { r.errors.push(ctx); },
    });
}

async function loadedStore(r: Rig): Promise<OpenHistoryStore> {
    const s = storeOn(r);
    await s.refresh();
    return s;
}

// A fresh store over the same disk, i.e. a plugin restart.
async function restart(r: Rig): Promise<OpenHistoryStore> {
    return loadedStore({ ...r, timers: new ManualTimers() });
}

function fileLines(r: Rig): string[] {
    return (r.adapter.files.get(FILE) ?? '').split('\n').filter(l => l !== '');
}

describe('OpenHistoryStore recordOpen', () => {
    let r: Rig;
    let store: OpenHistoryStore;
    beforeEach(async () => { r = rig(); store = await loadedStore(r); });

    it('GIVEN an open WHEN looked up THEN the in-memory lookup reflects it immediately', () => {
        store.recordOpen('notes/a.md');
        expect(store.lastOpenedMs('notes/a.md')).toBe(T0);
    });

    it('GIVEN a never-opened path WHEN looked up THEN it returns undefined', () => {
        expect(store.lastOpenedMs('notes/never.md')).toBeUndefined();
    });

    it('GIVEN two opens of one path WHEN looked up THEN the later time wins', () => {
        store.recordOpen('a.md');
        r.clock.ms = T0 + 5000;
        store.recordOpen('a.md');
        expect(store.lastOpenedMs('a.md')).toBe(T0 + 5000);
    });

    it('GIVEN an open WHEN the batch window has not elapsed THEN nothing is written yet', () => {
        store.recordOpen('a.md');
        expect(r.adapter.files.has(FILE)).toBe(false);
    });

    it('GIVEN an open WHEN the flush is scheduled THEN it uses the batch window', () => {
        store.recordOpen('a.md');
        expect([...r.timers.pending.values()].map(t => t.ms)).toEqual([FLUSH_BATCH_WINDOW_MS]);
    });

    it('GIVEN several opens WHEN the batch window elapses THEN one append writes them all', async () => {
        store.recordOpen('a.md');
        store.recordOpen('b.png');
        r.timers.fireAll();
        await store.flushNow();
        expect(fileLines(r)).toHaveLength(2);
    });

    it('GIVEN an open flushed to disk WHEN the plugin restarts THEN the persisted time is returned', async () => {
        store.recordOpen('a.md');
        await store.flushNow();
        const after = await restart(r);
        expect(after.lastOpenedMs('a.md')).toBe(T0);
    });

    it('GIVEN pending opens WHEN disposed THEN they are flushed', async () => {
        store.recordOpen('a.md');
        await store.dispose();
        expect(fileLines(r)).toHaveLength(1);
    });
});

describe('OpenHistoryStore rename', () => {
    let r: Rig;
    let store: OpenHistoryStore;
    beforeEach(async () => {
        r = rig();
        store = await loadedStore(r);
        store.recordOpen('A/x.md');
        store.recordOpen('A/sub/y.md');
        store.recordOpen('Untitled.md');
    });

    it('GIVEN an opened file WHEN renamed THEN the new path returns the old time', () => {
        store.rename('Untitled.md', 'Real name.md');
        expect(store.lastOpenedMs('Real name.md')).toBe(T0);
    });

    it('GIVEN an opened file WHEN renamed THEN the old path returns nothing', () => {
        store.rename('Untitled.md', 'Real name.md');
        expect(store.lastOpenedMs('Untitled.md')).toBeUndefined();
    });

    it('GIVEN a folder of opened files WHEN the folder is renamed THEN every file inside carries its time', () => {
        store.rename('A', 'B');
        expect([store.lastOpenedMs('B/x.md'), store.lastOpenedMs('B/sub/y.md')]).toEqual([T0, T0]);
    });

    it('GIVEN a folder rename WHEN a sibling folder shares the name prefix THEN the sibling is untouched', () => {
        store.recordOpen('AB/z.md');
        store.rename('A', 'B');
        expect(store.lastOpenedMs('AB/z.md')).toBe(T0);
    });

    it('GIVEN a rename WHEN the plugin restarts THEN the moved time survives and the old path stays empty', async () => {
        store.rename('Untitled.md', 'Real name.md');
        await store.flushNow();
        const after = await restart(r);
        expect([after.lastOpenedMs('Real name.md'), after.lastOpenedMs('Untitled.md')]).toEqual([T0, undefined]);
    });

    // Real Obsidian may fire the folder event, per-file events, or both — any mix
    // must land in the same state.
    async function persistedAfter(events: [string, string][]): Promise<[string, number][]> {
        const rr = rig();
        const s = await loadedStore(rr);
        s.recordOpen('A/x.md');
        s.recordOpen('A/sub/y.md');
        for (const [from, to] of events) s.rename(from, to);
        await s.flushNow();
        const after = await restart(rr);
        return ['A/x.md', 'A/sub/y.md', 'B/x.md', 'B/sub/y.md'].map(p => [p, after.lastOpenedMs(p) ?? -1]);
    }

    it('GIVEN a folder rename WHEN both the folder event and per-file events arrive THEN the result equals the folder event alone', async () => {
        const folderOnly = await persistedAfter([['A', 'B']]);
        const both = await persistedAfter([['A', 'B'], ['A/x.md', 'B/x.md'], ['A/sub/y.md', 'B/sub/y.md']]);
        expect(both).toEqual(folderOnly);
    });

    it('GIVEN a folder rename WHEN per-file events arrive before the folder event THEN the result equals the per-file events alone', async () => {
        const filesOnly = await persistedAfter([['A/x.md', 'B/x.md'], ['A/sub/y.md', 'B/sub/y.md']]);
        const both = await persistedAfter([['A/x.md', 'B/x.md'], ['A/sub/y.md', 'B/sub/y.md'], ['A', 'B']]);
        expect(both).toEqual(filesOnly);
    });
});

describe('OpenHistoryStore bounded size', () => {
    it('GIVEN a long run of opens of a few notes WHEN flushed after each THEN the file ends up one line per note', async () => {
        const r = rig();
        const store = await loadedStore(r);
        const notes = ['a.md', 'b.md', 'c.md'];
        for (let i = 0; i < REWRITE_AFTER_APPENDED_LINES * 2; i++) {
            r.clock.ms = T0 + i;
            store.recordOpen(notes[i % notes.length]);
            await store.flushNow();
        }
        expect(fileLines(r)).toHaveLength(notes.length);
    });

    it('GIVEN a rewrite WHEN reloaded THEN each path keeps its newest time', async () => {
        const r = rig();
        const store = await loadedStore(r);
        for (let i = 0; i < REWRITE_AFTER_APPENDED_LINES; i++) {
            r.clock.ms = T0 + i;
            store.recordOpen('a.md');
            await store.flushNow();
        }
        const after = await restart(r);
        expect(after.lastOpenedMs('a.md')).toBe(T0 + REWRITE_AFTER_APPENDED_LINES - 1);
    });

    it('GIVEN a file with duplicate lines and a deleted note WHEN pruning is enabled THEN it is rewritten to one line per live path', async () => {
        const r = rig();
        r.adapter.files.set(FILE, [
            JSON.stringify({ path: 'a.md', ms: 1 }),
            JSON.stringify({ path: 'a.md', ms: 2 }),
            JSON.stringify({ path: 'gone.md', ms: 3 }),
        ].join('\n') + '\n');
        const store = await loadedStore(r);
        await store.enablePruning(p => p !== 'gone.md');
        expect(fileLines(r)).toEqual([JSON.stringify({ path: 'a.md', ms: 2 })]);
    });

    it('GIVEN pruning WHEN a path is no longer in the vault THEN the lookup drops it too', async () => {
        const r = rig();
        const store = await loadedStore(r);
        store.recordOpen('gone.md');
        await store.enablePruning(() => false);
        expect(store.lastOpenedMs('gone.md')).toBeUndefined();
    });

    it('GIVEN pruning was never enabled WHEN the threshold rewrite runs THEN no path is dropped', async () => {
        const r = rig();
        const store = await loadedStore(r);
        store.recordOpen('kept.md');
        for (let i = 0; i < REWRITE_AFTER_APPENDED_LINES; i++) { store.recordOpen('a.md'); await store.flushNow(); }
        const after = await restart(r);
        expect(after.lastOpenedMs('kept.md')).toBe(T0);
    });
});

describe('OpenHistoryStore resilience', () => {
    it('GIVEN a torn line in the middle WHEN loaded THEN every other line still loads', async () => {
        const r = rig();
        r.adapter.files.set(FILE, `${JSON.stringify({ path: 'a.md', ms: 1 })}\n{"path":"b.m\n${JSON.stringify({ path: 'c.md', ms: 3 })}\n`);
        const store = await loadedStore(r);
        expect([store.lastOpenedMs('a.md'), store.lastOpenedMs('c.md')]).toEqual([1, 3]);
    });

    it('GIVEN a file ending in a torn line WHEN a new open is appended THEN the new open survives a restart', async () => {
        const r = rig();
        r.adapter.files.set(FILE, `${JSON.stringify({ path: 'a.md', ms: 1 })}\n{"path":"b.m`);
        const store = await loadedStore(r);
        store.recordOpen('new.md');
        await store.flushNow();
        const after = await restart(r);
        expect(after.lastOpenedMs('new.md')).toBe(T0);
    });

    it('GIVEN lines of the wrong shape WHEN parsed THEN they are skipped', () => {
        const text = ['null', '[]', '{"path":"x.md"}', '{"path":"","ms":1}', '{"path":"y.md","ms":"2"}', '{"path":"ok.md","ms":5}'].join('\n');
        expect([...parseOpenHistory(text)]).toEqual([['ok.md', 5]]);
    });

    it('GIVEN a rewrite crashed leaving only the temp file WHEN loaded THEN the temp file is used', async () => {
        const r = rig();
        r.adapter.files.set(`${FILE}.tmp`, `${JSON.stringify({ path: 'a.md', ms: 7 })}\n`);
        const store = await loadedStore(r);
        expect(store.lastOpenedMs('a.md')).toBe(7);
    });

    it('GIVEN only the temp file WHEN loaded THEN it is restored as the real file', async () => {
        const r = rig();
        r.adapter.files.set(`${FILE}.tmp`, `${JSON.stringify({ path: 'a.md', ms: 7 })}\n`);
        await loadedStore(r);
        expect([r.adapter.files.has(FILE), r.adapter.files.has(`${FILE}.tmp`)]).toEqual([true, false]);
    });

    it('GIVEN only the temp file and the restore rename fails WHEN a new open is flushed THEN the temp content still survives a restart', async () => {
        const r = rig();
        r.adapter.files.set(`${FILE}.tmp`, `${JSON.stringify({ path: 'a.md', ms: 7 })}\n`);
        r.adapter.failRenames = 1;
        const store = await loadedStore(r);
        store.recordOpen('b.md');
        await store.flushNow();
        const after = await restart(r);
        expect(after.lastOpenedMs('a.md')).toBe(7);
    });

    it('GIVEN the real file and a stale temp file WHEN loaded THEN the real file wins', async () => {
        const r = rig();
        r.adapter.files.set(FILE, `${JSON.stringify({ path: 'a.md', ms: 1 })}\n`);
        r.adapter.files.set(`${FILE}.tmp`, `${JSON.stringify({ path: 'a.md', ms: 99 })}\n`);
        const store = await loadedStore(r);
        expect(store.lastOpenedMs('a.md')).toBe(1);
    });

    it('GIVEN append and its read+rewrite fallback both fail WHEN the next flush runs THEN the stamp is written', async () => {
        const r = rig();
        r.adapter.files.set(FILE, `${JSON.stringify({ path: 'old.md', ms: 1 })}\n`);
        const store = await loadedStore(r);
        r.adapter.failAppends = 1;
        r.adapter.failReads = 1;
        store.recordOpen('a.md');
        await store.flushNow();
        r.timers.fireAll();
        await store.flushNow();
        const after = await restart(r);
        expect(after.lastOpenedMs('a.md')).toBe(T0);
    });

    it('GIVEN an append that fails WHEN flushed THEN a retry is scheduled', async () => {
        const r = rig();
        r.adapter.files.set(FILE, '');
        const store = await loadedStore(r);
        r.adapter.failAppends = 1;
        r.adapter.failReads = 1;
        store.recordOpen('a.md');
        await store.flushNow();
        expect(r.timers.pending.size).toBe(1);
    });

    it('GIVEN the file exists but cannot be read WHEN pruning runs THEN the unread history is not overwritten', async () => {
        const r = rig();
        const original = `${JSON.stringify({ path: 'a.md', ms: 1 })}\n`;
        r.adapter.files.set(FILE, original);
        r.adapter.failReads = 1;
        const store = await loadedStore(r);
        await store.enablePruning(() => true);
        expect(r.adapter.files.get(FILE)).toBe(original);
    });
});

describe('OpenHistoryStore before load completes', () => {
    it('GIVEN an open recorded before the load finished WHEN the load completes THEN the open is kept', async () => {
        const r = rig();
        r.adapter.files.set(FILE, `${JSON.stringify({ path: 'a.md', ms: 1 })}\n`);
        const store = storeOn(r);
        store.recordOpen('b.md');
        await store.refresh();
        expect([store.lastOpenedMs('a.md'), store.lastOpenedMs('b.md')]).toEqual([1, T0]);
    });

    it('GIVEN an open recorded before the load finished WHEN flushed THEN it survives a restart', async () => {
        const r = rig();
        const store = storeOn(r);
        store.recordOpen('b.md');
        await store.refresh();
        await store.flushNow();
        const after = await restart(r);
        expect(after.lastOpenedMs('b.md')).toBe(T0);
    });

    it('GIVEN a rename of a persisted path before the load finished WHEN the load completes THEN the new path has the persisted time', async () => {
        const r = rig();
        r.adapter.files.set(FILE, `${JSON.stringify({ path: 'a.md', ms: 1 })}\n`);
        const store = storeOn(r);
        store.rename('a.md', 'b.md');
        await store.refresh();
        expect([store.lastOpenedMs('a.md'), store.lastOpenedMs('b.md')]).toEqual([undefined, 1]);
    });
});

describe('open-history file is invisible to sidecar code', () => {
    it('GIVEN the open-history file path WHEN its owner is parsed as a sidecar artifact THEN it is not recognised', () => {
        expect(deviceIdFromArtifactPath(FILE)).toBeNull();
    });

    it('GIVEN the open-history temp file path WHEN its real name is parsed as a sidecar artifact THEN it is not recognised', () => {
        expect(deviceIdFromArtifactPath(`${FILE}.tmp`.slice(0, -'.tmp'.length))).toBeNull();
    });

    it('GIVEN a peer sidecar jsonl WHEN this store writes THEN the sidecar dir signature is unchanged', async () => {
        const r = rig();
        r.adapter.files.set(`${DIR}/index.mobile-9f3a1c08-1c9f03be.jsonl`, '{}\n');
        const asDataAdapter = r.adapter as unknown as DataAdapter;
        const before = await sidecarDirSignature(asDataAdapter, DIR, SELF);
        const store = await loadedStore(r);
        store.recordOpen('a.md');
        await store.flushNow();
        await store.enablePruning(() => true);
        expect(await sidecarDirSignature(asDataAdapter, DIR, SELF)).toBe(before);
    });
});
