// SearchOrchestrator.similarNotes + onIndexChanged — tier-2 scenario (REAL
// orchestrator + IndexStore on fake-indexeddb, deterministic token-bag embedder,
// so shared words raise cosine). Pins the wiring the pure ranking in
// similar-notes.ts can't see: source rows read from the frame, self-exclusion
// through the selection mask, one result per note, and the empty cases.

import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Scenario } from './test-harness/scenario';
import type { SimilarityMode } from './similar-notes';

const TOP_K = 10;
const MODES: SimilarityMode[] = ['best-chunk', 'average'];
const T = 1000;

// Sections must clear the chunker's 50-char minimum or they fold together.
const APPLES = 'apple orchard harvest cider apple orchard harvest cider apple orchard';
const BOATS = 'boat harbour sailing anchor boat harbour sailing anchor boat harbour';

let s: Scenario;
const paths = (rs: { note_path: string }[]): string[] => rs.map(r => r.note_path);

describe('GIVEN a source note, a close note and a far note', () => {
    beforeEach(async () => {
        s = new Scenario();
        await s.boot();
        s.vault.write('Source.md', APPLES, T);
        s.vault.write('Close.md', `${APPLES} pie`, T);
        s.vault.write('Far.md', BOATS, T);
        await s.coldStart();
    });
    afterEach(async () => { await s.teardown(); });

    it.each(MODES)('WHEN similar notes are requested in %s mode THEN the close note ranks first', async mode => {
        const results = await s.orch.similarNotes('Source.md', mode, TOP_K);
        expect(results[0].note_path).toBe('Close.md');
    });

    it.each(MODES)('WHEN similar notes are requested in %s mode THEN the source note is not among them', async mode => {
        const results = await s.orch.similarNotes('Source.md', mode, TOP_K);
        expect(paths(results)).not.toContain('Source.md');
    });

    it('WHEN a note that is not indexed is requested THEN the result is empty', async () => {
        expect(await s.orch.similarNotes('Nope.md', 'best-chunk', TOP_K)).toEqual([]);
    });

    it('WHEN the source note is probed THEN it is reported as indexed', async () => {
        expect(await s.orch.isNoteIndexed('Source.md')).toBe(true);
    });

    it('WHEN a note that is not indexed is probed THEN it is reported as not indexed', async () => {
        expect(await s.orch.isNoteIndexed('Nope.md')).toBe(false);
    });

    it('WHEN the results\' vectors are read THEN every result has one (cluster-graph ready)', async () => {
        const results = await s.orch.similarNotes('Source.md', 'best-chunk', TOP_K);
        const vectors = await s.orch.resultVectors(results);
        expect(vectors.every(v => v !== null)).toBe(true);
    });
});

describe('GIVEN a candidate note with several sections that all match the source', () => {
    beforeEach(async () => {
        s = new Scenario();
        await s.boot();
        s.vault.write('Source.md', APPLES, T);
        s.vault.write('Multi.md', `# One\n${APPLES} pie\n\n# Two\n${APPLES} tart\n`, T);
        await s.coldStart();
    });
    afterEach(async () => { await s.teardown(); });

    it.each(MODES)('WHEN similar notes are requested in %s mode THEN that note appears once', async mode => {
        const results = await s.orch.similarNotes('Source.md', mode, TOP_K);
        expect(paths(results)).toEqual(['Multi.md']);
    });
});

// Source has an apples section and a boats section. OneTopic is all apples;
// Blend mixes both topics in ONE chunk. Best-chunk: the apples section matches
// OneTopic near-perfectly. Average: the averaged source sits between the topics,
// right where Blend is.
describe('GIVEN a two-topic source note, a one-topic note and a blended note', () => {
    beforeEach(async () => {
        s = new Scenario();
        await s.boot();
        s.vault.write('Source.md', `# Apples\n${APPLES}\n\n# Boats\n${BOATS}\n`, T);
        s.vault.write('OneTopic.md', APPLES, T);
        s.vault.write('Blend.md', `${APPLES} ${BOATS}`, T);
        await s.coldStart();
    });
    afterEach(async () => { await s.teardown(); });

    it('WHEN best-chunk mode THEN the one-topic note ranks first', async () => {
        const results = await s.orch.similarNotes('Source.md', 'best-chunk', TOP_K);
        expect(results[0].note_path).toBe('OneTopic.md');
    });

    it('WHEN average mode THEN the blended note ranks first', async () => {
        const results = await s.orch.similarNotes('Source.md', 'average', TOP_K);
        expect(results[0].note_path).toBe('Blend.md');
    });
});

describe('GIVEN an empty index', () => {
    beforeEach(async () => {
        s = new Scenario();
        await s.boot();
    });
    afterEach(async () => { await s.teardown(); });

    it('WHEN similar notes are requested THEN the result is empty', async () => {
        expect(await s.orch.similarNotes('Source.md', 'best-chunk', TOP_K)).toEqual([]);
    });
});

describe('GIVEN an index-changed listener', () => {
    let calls: number;
    beforeEach(async () => {
        s = new Scenario();
        await s.boot();
        s.vault.write('Source.md', APPLES, T);
        await s.coldStart();
        calls = 0;
    });
    afterEach(async () => { await s.teardown(); });

    it('WHEN a note is added THEN the listener is notified', async () => {
        s.orch.onIndexChanged(() => { calls++; });
        await s.create('New.md', BOATS, T + 1);
        expect(calls).toBeGreaterThan(0);
    });

    it('WHEN the listener unsubscribed before a note is added THEN it is not notified', async () => {
        const off = s.orch.onIndexChanged(() => { calls++; });
        off();
        await s.create('New.md', BOATS, T + 1);
        expect(calls).toBe(0);
    });
});
