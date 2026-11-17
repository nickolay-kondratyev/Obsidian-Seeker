// Cross-module tests (no same-named source) for the cold cross-device BM25 load
// (search.ts adoptCrossDeviceBm25): it must never adopt an artifact whose postings
// mostly don't map onto this vault's live chunk frame — e.g. ANOTHER vault's blob in
// a sidecar folder shared through a symlinked plugins folder synced to another
// machine — while the phone still piggybacks on the desktop's blob for the SAME
// vault. Ticket nid_n59bc5o9ybvac25py88oc1vi3_e.

import { describe, it, expect, beforeEach } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { MultiFieldBM25 } from './bm25';
import { adoptCrossDeviceBm25, bm25ArtifactOverlap, buildBm25Stamp, type Bm25PersistStamp } from './search';
import { bm25PathFor } from './sidecar';
import { gzipString } from './gzip';
import { FakeAdapter } from './test-harness/fake-vault';
import { DEFAULT_SETTINGS, type Chunk } from './types';
import type { MetaConfig } from './index-store';

const DIR = '.obsidian/plugins/seeker/index';
const LIVE_STAMP: Bm25PersistStamp = buildBm25Stamp(
    { embeddingDim: 384, lastIndexedAt: '2026-11-17T00:00:00.000Z', modelId: 'ml97' } as MetaConfig,
    0,
    DEFAULT_SETTINGS,
);

function chunk(id: string, content: string): Chunk {
    return {
        chunk_id: id, title: id, content, note_path: `${id}.md`, heading_path: [],
        metadata: { tags: [], aliases: [], created: null, modified: null, properties: {} },
        start_line: 0, end_line: 0,
    };
}

// The MiniSearch json a producer would publish for a corpus of `ids`.
function artifactJson(ids: string[]): string {
    const chunks = ids.map(id => chunk(id, `note ${id} about topic ${id}`));
    return new MultiFieldBM25().fit(chunks, new Map(chunks.map(c => [c.chunk_id, c.content]))).toJSON();
}

// Publish `ids` as producer `producerId`'s gzipped BM25 artifact (publishCrossDeviceBm25's shape).
async function publish(adapter: FakeAdapter, producerId: string, ids: string[]): Promise<void> {
    const gz = await gzipString(JSON.stringify({ json: artifactJson(ids), stamp: LIVE_STAMP }));
    await adapter.writeBinary(bm25PathFor(DIR, producerId), gz.slice().buffer);
}

// Producer this consumer adopts, given ranked `producers` and its live frame `liveIds`.
async function adoptedProducer(adapter: FakeAdapter, producers: string[], liveIds: string[]): Promise<string | null> {
    return adoptCrossDeviceBm25(adapter as unknown as DataAdapter, DIR, producers, LIVE_STAMP, new Set(liveIds), () => {});
}

const OWN_IDS = ['own-1', 'own-2', 'own-3', 'own-4'];
const OTHER_IDS = ['other-1', 'other-2', 'other-3', 'other-4'];

describe('GIVEN a shared sidecar holding another vault\'s fresher BM25 artifact and this vault\'s older one', () => {
    const OTHER_VAULT = 'desktop-77aa11bb-0badc0de';   // other machine, other vault
    const OWN_VAULT = 'desktop-2b7e54aa-1c9f03be';
    let adapter: FakeAdapter;

    beforeEach(async () => {
        adapter = new FakeAdapter();
        await publish(adapter, OTHER_VAULT, OTHER_IDS);
        await publish(adapter, OWN_VAULT, OWN_IDS);
    });

    it('WHEN the cold load walks producers freshest-first THEN it adopts this vault\'s artifact', async () => {
        expect(await adoptedProducer(adapter, [OTHER_VAULT, OWN_VAULT], OWN_IDS)).toBe(OWN_VAULT);
    });

    it('WHEN only the other vault\'s artifact is available THEN nothing is adopted (normal refit)', async () => {
        expect(await adoptedProducer(adapter, [OTHER_VAULT], OWN_IDS)).toBeNull();
    });
});

describe('GIVEN a desktop published the BM25 artifact of the vault a phone also syncs', () => {
    const DESKTOP = 'desktop-2b7e54aa-1c9f03be';
    let adapter: FakeAdapter;

    beforeEach(async () => {
        adapter = new FakeAdapter();
        await publish(adapter, DESKTOP, OWN_IDS);
    });

    it('WHEN the phone\'s frame holds the same chunks THEN it adopts the desktop\'s artifact (piggyback)', async () => {
        expect(await adoptedProducer(adapter, [DESKTOP], OWN_IDS)).toBe(DESKTOP);
    });

    it('WHEN one of the artifact\'s chunks was edited since (no longer live) THEN the phone still adopts it', async () => {
        expect(await adoptedProducer(adapter, [DESKTOP], ['own-1', 'own-2', 'own-3', 'own-4-edited'])).toBe(DESKTOP);
    });
});

describe('bm25ArtifactOverlap', () => {
    it('GIVEN every artifact doc is live THEN the overlap is 1', () => {
        expect(bm25ArtifactOverlap(artifactJson(OWN_IDS), new Set(OWN_IDS))).toBe(1);
    });

    it('GIVEN half the artifact docs are live THEN the overlap is 0.5', () => {
        expect(bm25ArtifactOverlap(artifactJson(OWN_IDS), new Set(['own-1', 'own-2']))).toBe(0.5);
    });

    it('GIVEN an artifact with no docs THEN the overlap is 0', () => {
        expect(bm25ArtifactOverlap(artifactJson([]), new Set(OWN_IDS))).toBe(0);
    });
});
