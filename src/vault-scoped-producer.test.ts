// Cross-module scenario tests (no same-named source): the sidecar producer id is
// VAULT-scoped (`<deviceId>-<vaultKey>`, SeekerLogger.producerId), so vaults that
// symlink `.obsidian/plugins` to one shared folder — and therefore share one
// sidecar dir — never write, compact, clear or sweep each other's files, while
// peers on other devices (and the phone piggybacking on a desktop) still hydrate.
// Ticket nid_5bp0gdi1w9d1svfcitafvnduh_e.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { App, DataAdapter } from 'obsidian';
import { SeekerLogger } from './logger';
import {
    bulkAppend, clearDevice, compactDevice, jsonlPathFor, listDeviceShards, recordLayout, scanJsonl,
    shardPathFor, sidecarDirSignature, sweepOrphanTmpFiles, SIDECAR_FORMAT, type SidecarSelf, type TierBytes,
} from './sidecar';
import { writeDeviceMeta } from './sidecar-meta';
import { hydrateFromSidecar, probePeerAhead, type HydrateDeps, type ReChunkedNote } from './sidecar-sync';
import type { Chunk } from './types';
import { Scenario } from './test-harness/scenario';
import { FakeAdapter } from './test-harness/fake-vault';

const DIR = '.obsidian/plugins/seeker/index';
const EXPECT = { modelId: 'ml97', revision: null, chunkerVersion: 3, dim: 384 };
const LAYOUT = recordLayout(EXPECT.dim);
const DEVICE_ID_KEY = 'seeker-device-id-v1';
// The filename charset every sidecar reader regex (sidecar.ts SHARD_RE/JSONL_RE/…)
// accepts — builds that predate the vault key must keep matching the new ids.
const PRODUCER_ID_CHARSET = /^[A-Za-z0-9-]+$/;

// One origin-wide localStorage per "device": every vault opened on that device
// sees the same store, hence the same deviceId — the collision's root.
function useDevice(deviceId: string): void {
    const map = new Map<string, string>([[DEVICE_ID_KEY, deviceId]]);
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => { map.set(k, v); },
        removeItem: (k: string) => { map.delete(k); },
    });
}

// The producer id a vault (identified by its Obsidian appId) writes under on the
// CURRENT device — taken from the real logger, the one source of that id.
function producerIdOf(vaultAppId: string): string {
    return selfOf(vaultAppId).producerId;
}

// The vault as a sidecar READER on the CURRENT device (its deviceId + producerId),
// from the real logger.
function selfOf(vaultAppId: string): SidecarSelf {
    const app = { vault: { adapter: new FakeAdapter() } } as unknown as App;
    const logger = new SeekerLogger(app, 'seeker', vaultAppId);
    return { deviceId: logger.deviceId, producerId: logger.producerId };
}

function tiers(seed: number): TierBytes {
    const q = new Int8Array(LAYOUT.qBytes).fill(seed % 100);
    const sign = new Uint8Array(LAYOUT.signBytes).fill(seed & 0xff);
    return { q, s: 0.01, sign };
}

async function seedProducer(adapter: DataAdapter, producerId: string, ids: string[], chunkerVersion = EXPECT.chunkerVersion): Promise<void> {
    await bulkAppend(adapter, DIR, producerId, ids.map((id, i) => ({ id, tiers: tiers(i + 1), mtime: 100 })), EXPECT.dim);
    await writeDeviceMeta(adapter, DIR, {
        format: SIDECAR_FORMAT, modelId: EXPECT.modelId, revision: EXPECT.revision,
        chunkerVersion, dim: EXPECT.dim, deviceId: producerId, lastFullReindex: null,
    });
}

async function liveIdsOf(adapter: DataAdapter, producerId: string): Promise<string[]> {
    const scan = await scanJsonl(adapter, [jsonlPathFor(DIR, producerId)]);
    return [...scan.map.keys()].sort();
}

// Hydrate a consumer (`reader`) whose live vault is one note holding `ids`; returns the ids restored.
async function hydratedIds(adapter: DataAdapter, reader: SidecarSelf, ids: string[]): Promise<string[]> {
    const restored: string[] = [];
    const deps: HydrateDeps = {
        adapter, indexDir: DIR, expect: EXPECT, self: reader,
        reChunk: async (): Promise<ReChunkedNote[]> => [{
            notePath: 'note.md', mtimeMs: 100,
            chunks: ids.map(id => ({ chunk_id: id, note_path: 'note.md' }) as unknown as Chunk),
        }],
        existingIds: async () => new Set<string>(),
        putQuantized: async chunks => { restored.push(...chunks.map(c => c.chunk_id)); },
        putFileRecord: async () => {},
    };
    await hydrateFromSidecar(deps);
    return restored.sort();
}

afterEach(() => vi.unstubAllGlobals());

describe('GIVEN two vaults on ONE device sharing one sidecar dir (symlinked plugins folder)', () => {
    let adapter: DataAdapter;
    let vaultA: string;
    let vaultB: string;
    let readerA: SidecarSelf;

    beforeEach(async () => {
        useDevice('desktop-2b7e54aa');
        adapter = new FakeAdapter() as unknown as DataAdapter;
        readerA = selfOf('appid-vault-a');
        vaultA = readerA.producerId;
        vaultB = producerIdOf('appid-vault-b');
        await seedProducer(adapter, vaultA, ['a1', 'a2', 'a3']);
        await seedProducer(adapter, vaultB, ['b1', 'b2', 'b3']);
    });

    it('THEN vault A\'s records survive vault B\'s seeding (no shared jsonl)', async () => {
        expect(await liveIdsOf(adapter, vaultA)).toEqual(['a1', 'a2', 'a3']);
    });

    it('WHEN vault B compacts its own sidecar THEN vault A\'s records are intact', async () => {
        // B's liveness oracle knows only B's notes — exactly why a shared file loses A's.
        await compactDevice(adapter, DIR, vaultB, async () => ({ ids: new Set(['b1']), complete: true }), { minDeadRatio: 0, minShardBytes: 0 });

        expect(await liveIdsOf(adapter, vaultA)).toEqual(['a1', 'a2', 'a3']);
    });

    it('WHEN vault B compacts its own sidecar THEN vault A still hydrates every chunk after an IDB loss', async () => {
        await compactDevice(adapter, DIR, vaultB, async () => ({ ids: new Set(['b1']), complete: true }), { minDeadRatio: 0, minShardBytes: 0 });

        expect(await hydratedIds(adapter, readerA, ['a1', 'a2', 'a3'])).toEqual(['a1', 'a2', 'a3']);
    });

    it('WHEN vault B clears its sidecar (the full-reindex wipe) THEN vault A\'s shards remain', async () => {
        await clearDevice(adapter, DIR, vaultB);

        expect((await listDeviceShards(adapter, DIR, vaultA)).length).toBeGreaterThan(0);
    });

    it('WHEN vault B sweeps orphan tmp files THEN vault A\'s in-flight tmp write is left alone', async () => {
        const inFlight = `${shardPathFor(DIR, vaultA, 99)}.tmp`;
        await adapter.writeBinary(inFlight, new ArrayBuffer(8));

        await sweepOrphanTmpFiles(adapter, DIR, vaultB);

        expect(await adapter.exists(inFlight)).toBe(true);
    });

    it('WHEN vault B rewrites its files THEN vault A\'s reconcile signature (self excluded) moves — B is a peer, not self', async () => {
        const before = await sidecarDirSignature(adapter, DIR, readerA);

        await bulkAppend(adapter, DIR, vaultB, [{ id: 'b4', tiers: tiers(9), mtime: 200 }], EXPECT.dim);

        expect(await sidecarDirSignature(adapter, DIR, readerA)).not.toBe(before);
    });
});

describe('GIVEN two vaults on ONE device sharing one sidecar dir, driven through the real orchestrator', () => {
    let a: Scenario;
    let b: Scenario;

    beforeEach(async () => {
        useDevice('desktop-2b7e54aa');
        a = new Scenario();
        b = new Scenario();
        b.vault.adapter = a.vault.adapter;   // the symlink: one physical sidecar dir
        await a.boot({}, { indexDir: DIR, producerId: producerIdOf('appid-vault-a') });
        await b.boot({}, { indexDir: DIR, producerId: producerIdOf('appid-vault-b') });
        a.vault.write('a.md', 'alpha note about mountain weather patterns', 1000);
        b.vault.write('b.md', 'beta note about sourdough starter hydration', 1000);
        await a.coldStart();
    });
    afterEach(async () => { await a.teardown(); await b.teardown(); });

    it('THEN vault A\'s full reindex published records under its own producer id (guards the test below against a vacuous pass)', async () => {
        const adapter = a.vault.adapter as unknown as DataAdapter;

        expect((await liveIdsOf(adapter, producerIdOf('appid-vault-a'))).length).toBeGreaterThan(0);
    });

    it('WHEN vault B runs a full reindex THEN vault A\'s sidecar records are intact', async () => {
        const adapter = a.vault.adapter as unknown as DataAdapter;
        const before = await liveIdsOf(adapter, producerIdOf('appid-vault-a'));

        await b.coldStart();

        expect(await liveIdsOf(adapter, producerIdOf('appid-vault-a'))).toEqual(before);
    });

    it('WHEN vault B is present THEN vault A sees it as a peer producer', async () => {
        await b.coldStart();

        expect(await a.orch.peerSidecarPresent()).toBe(true);
    });

    it('WHEN only vault A has written THEN vault A does not count itself as a peer', async () => {
        expect(await a.orch.peerSidecarPresent()).toBe(false);
    });
});

describe('GIVEN a desktop producer written under its vault-keyed producer id', () => {
    let adapter: DataAdapter;
    let desktop: string;

    beforeEach(async () => {
        adapter = new FakeAdapter() as unknown as DataAdapter;
        useDevice('desktop-2b7e54aa');
        desktop = producerIdOf('appid-desktop-vault');
        await seedProducer(adapter, desktop, ['n1', 'n2']);
    });

    it('THEN the producer id keeps the device prefix in front', () => {
        expect(desktop.startsWith('desktop-2b7e54aa-')).toBe(true);
    });

    it('THEN the producer id stays inside the sidecar filename charset older builds match', () => {
        expect(desktop).toMatch(PRODUCER_ID_CHARSET);
    });

    it('WHEN a phone (own id mobile-…-<its vault key>) hydrates THEN it piggybacks on the desktop\'s vectors', async () => {
        useDevice('mobile-9f3a1c08');   // same synced vault, different device → different appId + deviceId

        expect(await hydratedIds(adapter, selfOf('appid-phone-vault'), ['n1', 'n2'])).toEqual(['n1', 'n2']);
    });

    it('WHEN the phone computes its reconcile signature THEN the desktop\'s files are not mistaken for its own', async () => {
        const desktopReader = selfOf('appid-desktop-vault');
        useDevice('mobile-9f3a1c08');
        const phone = selfOf('appid-phone-vault');

        expect(await sidecarDirSignature(adapter, DIR, phone)).not.toBe(await sidecarDirSignature(adapter, DIR, desktopReader));
    });

    it('WHEN an OTHER-device peer on an older build (un-keyed `desktop-<id>` name) is also present THEN both producers hydrate', async () => {
        await seedProducer(adapter, 'desktop-77aa11bb', ['old1']);

        expect(await hydratedIds(adapter, selfOf('appid-desktop-vault'), ['n1', 'n2', 'old1'])).toEqual(['n1', 'n2', 'old1']);
    });

    it('WHEN a vault-keyed peer is on a newer chunker THEN the peer-ahead probe reports it', async () => {
        const reader = selfOf('appid-desktop-vault');
        useDevice('desktop-0c0c0c0c');   // the peer: another desktop
        await seedProducer(adapter, producerIdOf('appid-newer-vault'), ['x1'], EXPECT.chunkerVersion + 1);

        expect(await probePeerAhead(adapter, DIR, EXPECT, reader)).toBe(true);
    });
});

describe('GIVEN a desktop that indexed a synced vault under its vault-keyed producer id (real orchestrator)', () => {
    const NOTE = 'shared note about alpine glacier retreat measurements';
    let desktop: Scenario;
    let phone: Scenario;

    beforeEach(async () => {
        useDevice('desktop-2b7e54aa');
        desktop = new Scenario();
        await desktop.boot({}, { indexDir: DIR, producerId: producerIdOf('appid-desktop-vault') });
        desktop.vault.write('n.md', NOTE, 1000);
        await desktop.coldStart();

        useDevice('mobile-9f3a1c08');   // the phone: other device, other appId, empty index
        phone = new Scenario();
        phone.vault.adapter = desktop.vault.adapter;   // the sync: same sidecar dir
        phone.vault.write('n.md', NOTE, 1000);
        await phone.boot({}, { indexDir: DIR, producerId: producerIdOf('appid-phone-vault') });
    });
    afterEach(async () => { await desktop.teardown(); await phone.teardown(); });

    it('WHEN the phone hydrates THEN its index is filled from the desktop\'s vectors (piggyback)', async () => {
        await phone.orch.hydrateSidecar();

        // The phone never embeds here, so any chunk it holds came from the desktop's files.
        expect((await phone.store.count()).chunks).toBeGreaterThan(0);
    });

    it('WHEN the phone hydrates THEN the desktop is the producer it accepted', async () => {
        const result = await phone.orch.hydrateSidecar();

        expect(result?.acceptedProducers).toBe(1);
    });
});

// Human decision: files written before the vault key (`*.<deviceId>.*`) get no
// migration and no cleanup — the upgraded build just reads them as a peer
// producer. These pin that nothing destroys them and that they still restore.
describe('GIVEN a vault whose sidecar was written by a build that predates the vault key (un-keyed `<deviceId>` files)', () => {
    const LEGACY_PRODUCER = 'desktop-2b7e54aa';
    let before: Scenario;
    let upgraded: Scenario;
    let adapter: DataAdapter;
    let legacyIds: string[];

    beforeEach(async () => {
        useDevice(LEGACY_PRODUCER);
        before = new Scenario();
        await before.boot({}, { indexDir: DIR, producerId: LEGACY_PRODUCER });
        before.vault.write('n.md', 'legacy note about tidal estuary sediment transport', 1000);
        await before.coldStart();
        adapter = before.vault.adapter as unknown as DataAdapter;
        legacyIds = await liveIdsOf(adapter, LEGACY_PRODUCER);

        upgraded = new Scenario();   // same vault after the upgrade; a fresh (lost) IndexedDB
        upgraded.vault.adapter = before.vault.adapter;
        upgraded.vault.write('n.md', 'legacy note about tidal estuary sediment transport', 1000);
        await upgraded.boot({}, { indexDir: DIR, producerId: producerIdOf('appid-vault-a') });
    });
    afterEach(async () => { await before.teardown(); await upgraded.teardown(); });

    it('THEN the legacy build did write records (guards the tests below against a vacuous pass)', () => {
        expect(legacyIds.length).toBeGreaterThan(0);
    });

    it('WHEN the upgraded build runs a full reindex THEN the legacy files keep their records', async () => {
        await upgraded.coldStart();

        expect(await liveIdsOf(adapter, LEGACY_PRODUCER)).toEqual(legacyIds);
    });

    it('WHEN the upgraded build compacts its own sidecar THEN the legacy files keep their records', async () => {
        await upgraded.coldStart();

        await upgraded.orch.compactOwnSidecar();

        expect(await liveIdsOf(adapter, LEGACY_PRODUCER)).toEqual(legacyIds);
    });

    it('WHEN the upgraded build lost its index THEN it restores the vault from the legacy files', async () => {
        await upgraded.orch.hydrateSidecar();

        expect((await upgraded.store.count()).chunks).toBe(legacyIds.length);
    });
});
