// The one-time legacy sidecar migration (ticket nid_tu1d39wbva5bz5h2c2v7bjjlz_e),
// driven through the REAL SearchOrchestrator + IndexStore (tier-2 harness): a
// device that indexed under the bare `<deviceId>` producer name upgrades to a
// build that writes under `<deviceId>-<vaultKey>`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { Scenario, FakeVault } from './test-harness/scenario';
import { FakeAdapter } from './test-harness/fake-vault';
import {
    bm25PathFor, bulkAppend, jsonlPathFor, metaPathFor, recordLayout, shardPathFor, SIDECAR_FORMAT, type TierBytes,
} from './sidecar';
import { listProducerSidecarFiles } from './legacy-sidecar-migration';
import { readDeviceMeta, writeDeviceMeta } from './sidecar-meta';
import SeekerPlugin from './main';
import { DEFAULT_SETTINGS } from './types';

const DIR = '.obsidian/plugins/seeker/index';
const DEVICE = 'desktop-2b7e54aa';               // the legacy (un-keyed) producer name
const KEYED = `${DEVICE}-1c9f03be`;              // this vault's producer id after the upgrade
const OTHER_VAULT_SAME_DEVICE = `${DEVICE}-07d2e6a1`;
const PHONE = 'mobile-9f3a1c08-55aa01ff';
const OTHER_DEVICE_LEGACY = 'desktop-77aa11bb';  // another device still on the old build
const UPGRADED = { indexDir: DIR, producerId: KEYED, deviceId: DEVICE };
const NOTES: Record<string, string> = {
    'a.md': 'alpha note about mountain weather patterns',
    'b.md': 'beta note about sourdough starter hydration',
    'c.md': 'gamma note about tidal estuary sediment transport',
};
const T_INDEXED = 1000;
const T_LATER = 2000;

const adapterOf = (s: Scenario): DataAdapter => s.vault.adapter as unknown as DataAdapter;
const fakeOf = (s: Scenario): FakeAdapter => s.vault.adapter;
const legacyFiles = (s: Scenario): Promise<string[]> => listProducerSidecarFiles(adapterOf(s), DIR, DEVICE);
const chunkIds = async (s: Scenario): Promise<string[]> => (await s.store.getAllChunkIds()).sort();

// Every file of `producerId` with its content — to assert nothing touched it.
function snapshot(adapter: FakeAdapter, producerId: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [p, v] of adapter.files) if (p.includes(`.${producerId}.`)) out[p] = v;
    for (const [p, v] of adapter.binaries) if (p.includes(`.${producerId}.`)) out[p] = new Uint8Array(v).join(',');
    return out;
}

async function seedPeer(adapter: DataAdapter, producerId: string, ids: string[]): Promise<void> {
    const layout = recordLayout(384);
    const tiers: TierBytes = { q: new Int8Array(layout.qBytes).fill(3), s: 0.01, sign: new Uint8Array(layout.signBytes).fill(1) };
    await bulkAppend(adapter, DIR, producerId, ids.map(id => ({ id, tiers, mtime: 100 })), 384);
    await writeDeviceMeta(adapter, DIR, { format: SIDECAR_FORMAT, modelId: 'x', revision: null, chunkerVersion: 1, dim: 384, deviceId: producerId, lastFullReindex: null });
}

// GIVEN a device that indexed NOTES on the pre-vault-key build (sidecar under the
// bare device id, incl. a BM25 blob and a crashed write's .tmp).
async function indexedOnLegacyBuild(): Promise<Scenario> {
    const s = new Scenario();
    await s.boot({}, { indexDir: DIR, producerId: DEVICE, deviceId: DEVICE });
    for (const [p, body] of Object.entries(NOTES)) s.vault.write(p, body, T_INDEXED);
    await s.coldStart();
    await adapterOf(s).writeBinary(bm25PathFor(DIR, DEVICE), new ArrayBuffer(4));
    await adapterOf(s).writeBinary(`${shardPathFor(DIR, DEVICE, 99)}.tmp`, new ArrayBuffer(4));
    return s;
}

// The same vault's index restored from the sidecar files alone (lost IndexedDB).
async function restoredFromSidecar(from: Scenario): Promise<string[]> {
    const fresh = new Scenario();
    fresh.vault = from.vault;
    await fresh.boot({}, UPGRADED);
    await fresh.orch.hydrateSidecar();
    const ids = await chunkIds(fresh);
    await fresh.teardown();
    return ids;
}

describe('GIVEN a device with an intact index that upgrades from the un-keyed sidecar names', () => {
    let s: Scenario;
    let indexedIds: string[];

    beforeEach(async () => {
        s = await indexedOnLegacyBuild();
        indexedIds = await chunkIds(s);
        s.restart({}, UPGRADED);
    });
    afterEach(async () => { await s.teardown(); });

    it('THEN the legacy build left its files behind (guards the tests below against a vacuous pass)', async () => {
        expect((await legacyFiles(s)).length).toBeGreaterThanOrEqual(5);   // jsonl, shard, meta, bm25, .tmp
    });

    it('THEN before the migration the legacy files read as a phantom peer', async () => {
        expect(await s.orch.peerSidecarPresent()).toBe(true);
    });

    it('WHEN the migration runs THEN it reports migrated', async () => {
        expect((await s.orch.migrateLegacyOwnSidecar())?.outcome).toBe('migrated');
    });

    it('WHEN the migration runs THEN no un-keyed artifact of this device remains (incl. bm25 and .tmp)', async () => {
        await s.orch.migrateLegacyOwnSidecar();

        expect(await legacyFiles(s)).toEqual([]);
    });

    it('WHEN the migration runs and IndexedDB is then lost THEN the keyed sidecar alone restores the same chunk set', async () => {
        await s.orch.migrateLegacyOwnSidecar();

        expect(await restoredFromSidecar(s)).toEqual(indexedIds);
    });

    it('WHEN the migration runs THEN a single-device vault no longer sees a phantom peer', async () => {
        await s.orch.migrateLegacyOwnSidecar();

        expect(await s.orch.peerSidecarPresent()).toBe(false);
    });

    it('WHEN the migration runs THEN the keyed meta is accepted at the live identity', async () => {
        await s.orch.migrateLegacyOwnSidecar();

        expect((await readDeviceMeta(adapterOf(s), DIR, KEYED))?.deviceId).toBe(KEYED);
    });

    it('WHEN a later boot runs it again THEN it reports nothing to do', async () => {
        await s.orch.migrateLegacyOwnSidecar();

        expect((await s.orch.migrateLegacyOwnSidecar())?.outcome).toBe('no-legacy-files');
    });

    it('WHEN a later boot runs it again THEN no sidecar file is rewritten', async () => {
        await s.orch.migrateLegacyOwnSidecar();
        const writeBinary = vi.spyOn(fakeOf(s), 'writeBinary');
        const write = vi.spyOn(fakeOf(s), 'write');

        await s.orch.migrateLegacyOwnSidecar();

        expect(writeBinary.mock.calls.length + write.mock.calls.length).toBe(0);
    });

    it('WHEN a note was edited after the upgrade (keyed sidecar already holds part) THEN the keyed sidecar still restores the whole index', async () => {
        await s.edit('a.md', 'alpha note rewritten about glacier retreat', T_LATER);
        const idsAfterEdit = await chunkIds(s);

        await s.orch.migrateLegacyOwnSidecar();

        expect(await restoredFromSidecar(s)).toEqual(idsAfterEdit);
    });

    it('WHEN a brand-new note the legacy files never held is not indexed yet THEN the migration still runs', async () => {
        s.vault.write('new.md', 'a note synced in from the phone this morning', T_LATER);

        expect((await s.orch.migrateLegacyOwnSidecar())?.outcome).toBe('migrated');
    });

    it('WHEN the sidecar is disabled THEN nothing is touched', async () => {
        s.restart({ sidecarEnabled: false }, UPGRADED);
        const before = await legacyFiles(s);

        await s.orch.migrateLegacyOwnSidecar();

        expect(await legacyFiles(s)).toEqual(before);
    });

    describe('AND the migration is interrupted', () => {
        it('WHEN it crashes while writing the keyed sidecar THEN every legacy file is still there', async () => {
            const before = await legacyFiles(s);
            vi.spyOn(fakeOf(s), 'writeBinary').mockRejectedValue(new Error('disk full'));

            await s.orch.migrateLegacyOwnSidecar().catch(() => {});

            expect(await legacyFiles(s)).toEqual(before);
        });

        // "Crash between write and delete": the first legacy remove never happens.
        const crashBeforeDelete = async (): Promise<void> => {
            const remove = vi.spyOn(fakeOf(s), 'remove').mockRejectedValue(new Error('killed'));
            await s.orch.migrateLegacyOwnSidecar().catch(() => {});
            remove.mockRestore();
        };

        it('WHEN it crashes between the write and the delete THEN the keyed sidecar is already complete', async () => {
            await crashBeforeDelete();
            for (const p of await legacyFiles(s)) await adapterOf(s).remove(p);   // prove the keyed files stand alone

            expect(await restoredFromSidecar(s)).toEqual(indexedIds);
        });

        it('WHEN it crashes between the write and the delete THEN the next boot deletes the legacy files', async () => {
            await crashBeforeDelete();

            await s.orch.migrateLegacyOwnSidecar();

            expect(await legacyFiles(s)).toEqual([]);
        });

        it('WHEN it crashes between the write and the delete THEN the next boot does not rewrite the vectors', async () => {
            await crashBeforeDelete();

            expect((await s.orch.migrateLegacyOwnSidecar())?.chunksRewritten).toBe(0);
        });
    });

    describe('AND other producers share the sidecar dir', () => {
        for (const peer of [PHONE, OTHER_DEVICE_LEGACY, OTHER_VAULT_SAME_DEVICE]) {
            it(`WHEN the migration runs THEN ${peer}'s files are untouched`, async () => {
                await seedPeer(adapterOf(s), peer, ['p1', 'p2']);
                const before = snapshot(fakeOf(s), peer);

                await s.orch.migrateLegacyOwnSidecar();

                expect(snapshot(fakeOf(s), peer)).toEqual(before);
            });
        }
    });
});

describe('GIVEN an upgraded device whose index cannot vouch for itself', () => {
    let s: Scenario;
    let before: string[];
    afterEach(async () => { await s.teardown(); });

    const expectLegacyKept = async (outcome: string): Promise<void> => {
        const result = await s.orch.migrateLegacyOwnSidecar();
        expect({ outcome: result?.outcome, legacy: await legacyFiles(s) }).toEqual({ outcome, legacy: before });
    };

    it('WHEN the index is empty (IndexedDB lost) THEN the legacy files are kept', async () => {
        const legacy = await indexedOnLegacyBuild();
        await legacy.teardown();
        s = new Scenario();
        s.vault = legacy.vault;
        await s.boot({}, UPGRADED);
        before = await legacyFiles(s);

        await expectLegacyKept('index-empty');
    });

    it('WHEN the index is identity-stale THEN the legacy files are kept', async () => {
        s = await indexedOnLegacyBuild();
        s.restart({}, UPGRADED);
        const meta = await s.store.getMeta();
        await s.store.setMeta({ ...meta, chunkerVersion: (meta.chunkerVersion ?? 0) - 1 });
        before = await legacyFiles(s);

        await expectLegacyKept('index-identity-stale');
    });

    it('WHEN the index is only partially hydrated (a live note the legacy files hold is missing) THEN the legacy files are kept', async () => {
        s = await indexedOnLegacyBuild();
        s.restart({}, UPGRADED);
        await s.store.deleteFile('b.md');
        before = await legacyFiles(s);

        await expectLegacyKept('index-incomplete');
    });

    it('WHEN the keyed sidecar is from another identity THEN the legacy files are kept', async () => {
        s = await indexedOnLegacyBuild();
        s.restart({}, UPGRADED);
        await seedPeer(adapterOf(s), KEYED, ['stale1']);   // meta at a foreign model/chunker
        before = await legacyFiles(s);

        await expectLegacyKept('own-sidecar-stale');
    });
});

// The boot wiring in main.ts: Obsidian's layout-ready gate (src/CLAUDE.md root invariant).
describe('GIVEN an upgraded plugin starting up over legacy sidecar files', () => {
    class Workspace {
        layoutReady = false;
        private callbacks: (() => void)[] = [];
        onLayoutReady(cb: () => void): void { if (this.layoutReady) cb(); else this.callbacks.push(cb); }
        on(): object { return {}; }
        getActiveFile(): null { return null; }
        fireLayoutReady(): void { this.layoutReady = true; for (const cb of this.callbacks.splice(0)) cb(); }
    }
    class EventVault extends FakeVault {
        configDir = '.obsidian';
        on(): object { return {}; }
    }
    interface PluginInternals {
        store: unknown; orchestrator: unknown; logger: unknown; settings: unknown;
        idleTimer: number | null; structTimer: number | null;
        startIndexMaintenance(boot: { sidecarIndexDir: string; legacySidecarDir: string | null; migrateSidecarPath: boolean }): void;
        runBootReconcile(boot: unknown): Promise<void>;
        registerInterval(id: number): number;
    }
    let s: Scenario;
    let workspace: Workspace;
    let plugin: PluginInternals;
    let bootRuns: ReturnType<typeof vi.spyOn>;
    let intervals: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        s = new Scenario();
        s.vault = new EventVault();
        await s.boot({}, { indexDir: DIR, producerId: DEVICE, deviceId: DEVICE });
        for (const [p, body] of Object.entries(NOTES)) s.vault.write(p, body, T_INDEXED);
        await s.coldStart();
        s.restart({}, UPGRADED);
        workspace = new Workspace();
        const app = { vault: s.vault, workspace, metadataCache: { isUserIgnored: () => false, resolvedLinks: {} } };
        plugin = new SeekerPlugin(app as never, { id: 'seeker', dir: '.obsidian/plugins/seeker' } as never) as unknown as PluginInternals;
        plugin.store = s.store;
        plugin.orchestrator = s.orch;
        plugin.settings = structuredClone(DEFAULT_SETTINGS);
        plugin.logger = { deviceId: DEVICE, producerId: KEYED, append: async () => {}, appendError: async () => {} };
        bootRuns = vi.spyOn(plugin, 'runBootReconcile');
        intervals = vi.spyOn(plugin, 'registerInterval');
        plugin.startIndexMaintenance({ sidecarIndexDir: DIR, legacySidecarDir: null, migrateSidecarPath: false });
    });
    afterEach(async () => {
        for (const call of intervals.mock.calls) window.clearInterval(call[0] as number);
        if (plugin.idleTimer != null) window.clearTimeout(plugin.idleTimer);
        if (plugin.structTimer != null) window.clearTimeout(plugin.structTimer);
        await s.teardown();
    });
    const settleBootWork = (): Promise<unknown> => Promise.all(bootRuns.mock.results.map(r => r.value as Promise<void>));

    it('WHEN layout is not ready yet THEN the legacy files are not touched', async () => {
        const before = await legacyFiles(s);

        await settleBootWork();

        expect(await legacyFiles(s)).toEqual(before);
    });

    it('WHEN layout becomes ready THEN the boot work migrates and removes the legacy files', async () => {
        workspace.fireLayoutReady();
        await settleBootWork();

        expect(await legacyFiles(s)).toEqual([]);
    });

    it('WHEN layout becomes ready THEN the keyed files hold the index', async () => {
        workspace.fireLayoutReady();
        await settleBootWork();

        expect(await adapterOf(s).exists(jsonlPathFor(DIR, KEYED)) && await adapterOf(s).exists(metaPathFor(DIR, KEYED))).toBe(true);
    });
});
