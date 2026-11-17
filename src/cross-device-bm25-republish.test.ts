// Cross-module scenario tests (no same-named source) for the PRODUCER side of the
// cross-device BM25 artifact (search.ts publishCrossDeviceBm25, driven by
// warmCaches): a desktop whose BM25 cache is warm over a complete index re-publishes
// its keyed `bm25.<producerId>.json.gz` when it is missing (the vault-key rename and
// the legacy-file migration left none until the next full reindex) or no longer
// loadable (a stale stamp) — once, not on every warm — and a phone then adopts it.
// Ticket nid_s4h30wnw7qfkrj638iplwdacn_e.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Platform, type DataAdapter } from 'obsidian';
import { adoptCrossDeviceBm25, bm25StampMatches, buildBm25Stamp, readCrossDeviceBm25Artifact } from './search';
import { bm25PathFor } from './sidecar';
import { gzipString } from './gzip';
import { Scenario } from './test-harness/scenario';
import { DEFAULT_SETTINGS, type SeekerSettings } from './types';

const DIR = '.obsidian/plugins/seeker/index';
const DESKTOP = { producerId: 'desktop-2b7e54aa-07d2e6a1', deviceId: 'desktop-2b7e54aa' };
const PHONE = { producerId: 'mobile-9f3a1c08-1c9f03be', deviceId: 'mobile-9f3a1c08' };
const ARTIFACT = bm25PathFor(DIR, DESKTOP.producerId);
const NOTES: Record<string, string> = {
    'glacier.md': '# Glacier\n\nalpine glacier retreat measurements over three decades',
    'estuary.md': '# Estuary\n\ntidal estuary sediment transport and salinity',
    'orchard.md': '# Orchard\n\napple orchard pruning schedule for late winter',
};
const SETTLE_TIMEOUT_MS = 3000;
const SETTLE_POLL_MS = 10;

async function waitForArtifact(adapter: DataAdapter): Promise<void> {
    const t0 = Date.now();
    while (!(await adapter.exists(ARTIFACT))) {
        if (Date.now() - t0 > SETTLE_TIMEOUT_MS) throw new Error('full reindex never published the BM25 artifact');
        await new Promise(r => setTimeout(r, SETTLE_POLL_MS));
    }
}

// Writes of the artifact (writeBytesAtomic writes `<path>.tmp`, then renames).
function countArtifactWrites(adapter: DataAdapter): () => number {
    const spy = vi.spyOn(adapter, 'writeBinary');
    return () => spy.mock.calls.filter(([p]) => p === `${ARTIFACT}.tmp`).length;
}

// A desktop that fully indexed the vault (so its own full-reindex emit landed, and
// the test waits it out), then lost the keyed artifact — what the vault-key rename +
// legacy migration leave behind. `restart` is the next plugin session on that index.
class Desktop {
    s = new Scenario();
    get adapter(): DataAdapter { return this.s.vault.adapter as unknown as DataAdapter; }

    async indexed(): Promise<void> {
        await this.s.boot({}, { indexDir: DIR, ...DESKTOP });
        for (const [p, body] of Object.entries(NOTES)) this.s.vault.write(p, body, 1000);
        await this.s.coldStart();
        await waitForArtifact(this.adapter);
    }

    async dropArtifact(): Promise<void> { await this.adapter.remove(ARTIFACT); }

    restart(settings: Partial<SeekerSettings> = {}): void { this.s.restart(settings, { indexDir: DIR, ...DESKTOP }); }

    warm(): Promise<void> { return this.s.orch.warmCaches('model-load'); }

    artifactPresent(): Promise<boolean> { return this.adapter.exists(ARTIFACT); }
}

describe('GIVEN a desktop with a complete index whose keyed BM25 artifact is missing', () => {
    let desktop: Desktop;

    beforeEach(async () => {
        desktop = new Desktop();
        await desktop.indexed();
        await desktop.dropArtifact();
        desktop.restart();
    });
    afterEach(async () => { await desktop.s.teardown(); vi.restoreAllMocks(); });

    it('WHEN its caches warm THEN the keyed artifact is published', async () => {
        await desktop.warm();

        expect(await desktop.artifactPresent()).toBe(true);
    });

    it('WHEN its caches warm twice THEN the artifact is written exactly once', async () => {
        const writes = countArtifactWrites(desktop.adapter);

        await desktop.warm();
        await desktop.warm();

        expect(writes()).toBe(1);
    });

    // Boot's model-load warm can still be writing when an early modal-open warm runs;
    // two writers on one `.tmp` let the loser's rename fallback delete the artifact.
    it('WHEN a second warm runs while the first is still writing the artifact THEN it is written once', async () => {
        const realWrite = desktop.adapter.writeBinary.bind(desktop.adapter);
        let release!: () => void;
        const firstWriteHeld = new Promise<void>(r => { release = r; });
        let firstWriteStarted!: () => void;
        const firstWriteReached = new Promise<void>(r => { firstWriteStarted = r; });
        let held = false;
        const spy = vi.spyOn(desktop.adapter, 'writeBinary').mockImplementation(async (p, data) => {
            if (p === `${ARTIFACT}.tmp` && !held) { held = true; firstWriteStarted(); await firstWriteHeld; }
            return realWrite(p, data);
        });
        const first = desktop.warm();
        await firstWriteReached;

        await desktop.warm();
        release();
        await first;

        expect(spy.mock.calls.filter(([p]) => p === `${ARTIFACT}.tmp`).length).toBe(1);
    });

    it('WHEN its caches warm THEN the published artifact carries the live stamp', async () => {
        await desktop.warm();

        const rec = await readCrossDeviceBm25Artifact(desktop.adapter, ARTIFACT);
        const live = buildBm25Stamp(await desktop.s.store.getMeta(), 0, DEFAULT_SETTINGS);
        expect(bm25StampMatches(rec?.stamp, live)).toBe(true);
    });
});

describe('GIVEN a desktop whose keyed BM25 artifact is already published', () => {
    let desktop: Desktop;

    beforeEach(async () => {
        desktop = new Desktop();
        await desktop.indexed();
        desktop.restart();
    });
    afterEach(async () => { await desktop.s.teardown(); vi.restoreAllMocks(); });

    it('WHEN its caches warm THEN the artifact is not rewritten', async () => {
        const writes = countArtifactWrites(desktop.adapter);

        await desktop.warm();

        expect(writes()).toBe(0);
    });
});

describe('GIVEN a desktop whose keyed BM25 artifact has a stale stamp (built by an older analyzer)', () => {
    let desktop: Desktop;

    beforeEach(async () => {
        desktop = new Desktop();
        await desktop.indexed();
        const rec = await readCrossDeviceBm25Artifact(desktop.adapter, ARTIFACT);
        const stale = { ...(rec!.stamp as object), analyzerVersion: 'analyzer-from-an-older-build' };
        const gz = await gzipString(JSON.stringify({ json: rec!.json, stamp: stale }));
        await desktop.adapter.writeBinary(ARTIFACT, gz.slice().buffer);
        desktop.restart();
    });
    afterEach(async () => { await desktop.s.teardown(); vi.restoreAllMocks(); });

    it('WHEN its caches warm THEN the artifact is re-published with the live stamp', async () => {
        await desktop.warm();

        const rec = await readCrossDeviceBm25Artifact(desktop.adapter, ARTIFACT);
        const live = buildBm25Stamp(await desktop.s.store.getMeta(), 0, DEFAULT_SETTINGS);
        expect(bm25StampMatches(rec?.stamp, live)).toBe(true);
    });
});

// The same gates as the full-reindex emit: never from mobile, an incomplete index,
// a runtime without gzip, or with the sidecar off.
describe('GIVEN a desktop with no keyed BM25 artifact that does not qualify as a producer', () => {
    let desktop: Desktop;

    beforeEach(async () => {
        desktop = new Desktop();
        await desktop.indexed();
        await desktop.dropArtifact();
    });
    afterEach(async () => {
        await desktop.s.teardown();
        Platform.isMobile = false;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('WHEN its index never completed (no lastIndexedAt) and its caches warm THEN nothing is published', async () => {
        await desktop.s.store.setMeta({ ...(await desktop.s.store.getMeta()), lastIndexedAt: null });
        desktop.restart();

        await desktop.warm();

        expect(await desktop.artifactPresent()).toBe(false);
    });

    it('WHEN it runs on mobile and its caches warm THEN nothing is published', async () => {
        Platform.isMobile = true;
        desktop.restart();

        await desktop.warm();

        expect(await desktop.artifactPresent()).toBe(false);
    });

    it('WHEN gzip is unavailable and its caches warm THEN nothing is published', async () => {
        vi.stubGlobal('CompressionStream', undefined);
        desktop.restart();

        await desktop.warm();

        expect(await desktop.artifactPresent()).toBe(false);
    });

    it('WHEN the sidecar is off and its caches warm THEN nothing is published', async () => {
        desktop.restart({ sidecarEnabled: false });

        await desktop.warm();

        expect(await desktop.artifactPresent()).toBe(false);
    });
});

describe('GIVEN a desktop re-published its missing BM25 artifact and a phone hydrated the same vault', () => {
    let desktop: Desktop;
    let phone: Scenario;

    beforeEach(async () => {
        desktop = new Desktop();
        await desktop.indexed();
        await desktop.dropArtifact();
        desktop.restart();
        await desktop.warm();

        phone = new Scenario();
        phone.vault.adapter = desktop.s.vault.adapter;   // the sync: same sidecar dir
        for (const [p, body] of Object.entries(NOTES)) phone.vault.write(p, body, 1000);
        await phone.boot({}, { indexDir: DIR, ...PHONE });
        await phone.orch.hydrateSidecar();
    });
    afterEach(async () => { await desktop.s.teardown(); await phone.teardown(); });

    it('WHEN the phone cold-loads BM25 THEN it adopts the desktop\'s artifact (stamp + overlap gates pass)', async () => {
        const liveIds = await phone.store.getAllChunkIds();
        const live = buildBm25Stamp(await phone.store.getMeta(), liveIds.length, DEFAULT_SETTINGS);

        const adopted = await adoptCrossDeviceBm25(desktop.adapter, DIR, [DESKTOP.producerId], live, new Set(liveIds), () => {});

        expect(adopted).toBe(DESKTOP.producerId);
    });
});
