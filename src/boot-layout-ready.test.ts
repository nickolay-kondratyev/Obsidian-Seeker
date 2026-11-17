// Cross-module scenario: the plugin's boot reconcile vs Obsidian's vault load.
//
// Regression for "reopening a vault wipes its index" (ticket
// nid_oa3w5abv27trliro95mqpc7h9_e): onload used to diff the stored index against
// the live file list immediately, but Obsidian only finishes loading that list
// (firing a `create` per existing file) right before layout ready. The diff saw
// an empty vault, deleted every stored note, then the create flood re-queued them.
//
// Drives the REAL SeekerPlugin index-maintenance wiring over the tier-2 harness
// (real SearchOrchestrator + IndexStore on fake-indexeddb). Only Obsidian's two
// load-time behaviours are faked: the file list is empty until the vault finishes
// loading, and onLayoutReady callbacks queue until layout ready.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { Scenario, FakeVault } from './test-harness/scenario';
import SeekerPlugin from './main';
import type { IndexStore } from './index-store';
import type { SearchOrchestrator } from './search';

// Obsidian's vault during startup: files exist on disk but the vault reports none
// until it finishes loading, then fires `create` for each existing file (see
// obsidian.d.ts Vault.on('create')).
class LoadingVault extends FakeVault {
    configDir = '.obsidian';
    private loaded = true;
    private createListeners: ((f: TFile) => void)[] = [];

    on(name: string, cb: (f: TFile) => void): object {
        if (name === 'create') this.createListeners.push(cb);
        return {};
    }
    // A fresh Obsidian process: files stay on disk, the vault's list is empty again.
    closeObsidian(): void { this.loaded = false; this.createListeners = []; }
    finishLoading(): void {
        this.loaded = true;
        for (const f of this.getFiles()) this.emitCreate(f);
    }
    // A user creating a note mid-session.
    create(path: string, content: string, mtime: number): void {
        this.write(path, content, mtime);
        this.emitCreate(this.getAbstractFileByPath(path)!);
    }
    private emitCreate(f: TFile): void { for (const cb of this.createListeners) cb(f); }

    getMarkdownFiles(): TFile[] { return this.loaded ? super.getMarkdownFiles() : []; }
    getFiles(): TFile[] { return this.loaded ? super.getFiles() : []; }
    getAbstractFileByPath(path: string): TFile | null { return this.loaded ? super.getAbstractFileByPath(path) : null; }
}

class LoadingWorkspace {
    layoutReady = false;
    private readyCallbacks: (() => void)[] = [];

    onLayoutReady(cb: () => void): void {
        if (this.layoutReady) cb();
        else this.readyCallbacks.push(cb);
    }
    on(): object { return {}; }
    getActiveFile(): null { return null; }
    fireLayoutReady(): void {
        this.layoutReady = true;
        for (const cb of this.readyCallbacks.splice(0)) cb();
    }
}

interface BootSidecarContext { sidecarIndexDir: string; legacySidecarDir: string | null; migrateSidecarPath: boolean; }
// The private plugin state + methods onload wires; reached through a cast because
// onload itself needs the full Obsidian runtime (iframe, DOM, persisted data).
interface PluginInternals {
    store: IndexStore;
    orchestrator: SearchOrchestrator;
    logger: unknown;
    dirtyQueue: Set<string>;
    idleTimer: number | null;
    structTimer: number | null;
    startIndexMaintenance(boot: BootSidecarContext): void;
    runBootReconcile(boot: BootSidecarContext): Promise<void>;
    registerInterval(id: number): number;
}

const BOOT_CONTEXT: BootSidecarContext = { sidecarIndexDir: '.obsidian/plugins/seeker/index', legacySidecarDir: null, migrateSidecarPath: false };
const T_INDEXED = 1000;
const T_WHILE_CLOSED = 2000;
const T_MID_SESSION = 3000;

// One reopened Obsidian session over an already-indexed vault.
class ReopenedVault {
    readonly vault = new LoadingVault();
    readonly workspace = new LoadingWorkspace();
    readonly scenario = new Scenario();
    plugin!: PluginInternals;
    private bootRuns!: ReturnType<typeof vi.spyOn>;
    private intervals!: ReturnType<typeof vi.spyOn>;

    async indexNotes(notes: Record<string, string>): Promise<void> {
        this.scenario.vault = this.vault;
        await this.scenario.boot();
        for (const [path, body] of Object.entries(notes)) this.vault.write(path, body, T_INDEXED);
        await this.scenario.coldStart();
    }

    // Quit Obsidian and start it again: a NEW plugin instance over the same store,
    // with the vault's file list not loaded yet.
    reopen(): void {
        this.vault.closeObsidian();
        const app = { vault: this.vault, workspace: this.workspace, metadataCache: { isUserIgnored: () => false, resolvedLinks: {} } };
        const plugin = new SeekerPlugin(app as never, { id: 'seeker', dir: '.obsidian/plugins/seeker' } as never) as unknown as PluginInternals;
        plugin.store = this.scenario.store;
        plugin.orchestrator = this.scenario.orch;
        plugin.logger = { deviceId: 'test', producerId: 'test', append: async () => {}, appendError: async () => {} };
        this.bootRuns = vi.spyOn(plugin, 'runBootReconcile');
        this.intervals = vi.spyOn(plugin, 'registerInterval');
        this.plugin = plugin;
    }

    startPlugin(): void { this.plugin.startIndexMaintenance(BOOT_CONTEXT); }

    // Obsidian's startup order: the vault loads its file list (a `create` per
    // existing file), then the layout becomes ready.
    finishObsidianStartup(): void {
        this.vault.finishLoading();
        this.workspace.fireLayoutReady();
    }

    // Wait for every boot reconcile that has STARTED so far — an explicit condition,
    // not a sleep: before layout ready there must be none, after it exactly one.
    async settleBootWork(): Promise<void> {
        await Promise.all(this.bootRuns.mock.results.map(r => r.value as Promise<void>));
    }

    async fullStartup(): Promise<void> {
        this.startPlugin();
        await this.settleBootWork();      // whatever ran before the vault loaded has done its damage
        this.finishObsidianStartup();
        await this.settleBootWork();
    }

    async teardown(): Promise<void> {
        for (const call of this.intervals?.mock.calls ?? []) window.clearInterval(call[0] as number);
        if (this.plugin?.idleTimer != null) window.clearTimeout(this.plugin.idleTimer);
        if (this.plugin?.structTimer != null) window.clearTimeout(this.plugin.structTimer);
        await this.scenario.teardown();
    }
}

describe('boot reconcile waits for Obsidian to finish loading the vault', () => {
    let session: ReopenedVault | null = null;
    afterEach(async () => { await session?.teardown(); session = null; });

    // GIVEN an indexed vault reopened in a fresh Obsidian process
    const reopenedIndexedVault = async (): Promise<ReopenedVault> => {
        session = new ReopenedVault();
        await session.indexNotes({
            'a.md': 'the verge reviews the new pixel phone',
            'b.md': 'imogene heap concert notes and setlist',
            'c.md': 'sourdough starter feeding schedule',
        });
        session.reopen();
        return session;
    };

    it('keeps every stored chunk across a reopen', async () => {
        const s = await reopenedIndexedVault();
        const chunksBefore = (await s.scenario.store.count()).chunks;

        await s.fullStartup();

        expect((await s.scenario.store.count()).chunks).toBe(chunksBefore);
    });

    it('does not diff the index against the vault before layout ready', async () => {
        const s = await reopenedIndexedVault();
        const computeDelta = vi.spyOn(s.scenario.orch, 'computeDelta');

        s.startPlugin();
        await s.settleBootWork();

        expect(computeDelta).not.toHaveBeenCalled();
    });

    it('reconciles at once when the plugin is enabled after layout ready', async () => {
        const s = await reopenedIndexedVault();
        s.finishObsidianStartup();
        const computeDelta = vi.spyOn(s.scenario.orch, 'computeDelta');

        s.startPlugin();
        await s.settleBootWork();

        expect(computeDelta).toHaveBeenCalledTimes(1);
    });

    it('does not queue the startup flood of create events for re-indexing', async () => {
        const s = await reopenedIndexedVault();

        await s.fullStartup();

        expect([...s.plugin.dirtyQueue]).toEqual([]);
    });

    it('still queues a note created after layout ready', async () => {
        const s = await reopenedIndexedVault();
        await s.fullStartup();

        s.vault.create('new.md', 'a note written mid-session', T_MID_SESSION);

        expect(s.plugin.dirtyQueue.has('new.md')).toBe(true);
    });

    it('catches up notes edited, added and deleted while Obsidian was closed', async () => {
        const s = await reopenedIndexedVault();
        s.vault.write('a.md', 'the verge reviews the new pixel phone and its camera', T_WHILE_CLOSED);
        s.vault.remove('b.md');
        s.vault.write('d.md', 'a note synced in from another device', T_WHILE_CLOSED);
        const reindexDelta = vi.spyOn(s.scenario.orch, 'reindexDelta');

        await s.fullStartup();

        const [dirty, deleted] = reindexDelta.mock.calls[0];
        expect({ dirty: [...dirty].sort(), deleted }).toEqual({ dirty: ['a.md', 'd.md'], deleted: ['b.md'] });
    });
});
