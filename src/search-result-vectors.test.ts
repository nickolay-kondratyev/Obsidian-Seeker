// SearchOrchestrator.resultVectors — the cluster graph's vector read. Tier-2
// scenario (REAL orchestrator + IndexStore on fake-indexeddb, deterministic
// embedder): the contract the graph relies on is "aligned to the input order,
// null where missing", which only the real store read can prove.

import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Scenario } from './test-harness/scenario';
import type { ScoredChunk } from './types';

const MISSING_CHUNK_ID = 'no-such-chunk';

let s: Scenario;
let results: ScoredChunk[];

describe('GIVEN an index with two notes and a search returning both', () => {
    beforeEach(async () => {
        s = new Scenario();
        await s.boot();
        s.vault.write('Apple.md', 'apple orchard harvest', 1000);
        s.vault.write('Boat.md', 'boat harbour sailing', 1000);
        await s.coldStart();
        results = (await s.orch.search('apple boat')).results;
        // Guard: with fewer than two results the alignment test would be vacuous.
        expect(results.length).toBe(2);
    });
    afterEach(async () => { await s.teardown(); });

    it('WHEN vectors are read in reversed result order THEN each slot holds its own result\'s vector', async () => {
        const reversed = [...results].reverse();
        const perResult = await Promise.all(reversed.map(async r => (await s.store.getEmbeddingsByIds([r.chunk_id]))[0]));
        expect(await s.orch.resultVectors(reversed)).toEqual(perResult);
    });

    it('WHEN one result has no stored vector THEN its slot is null', async () => {
        const vectors = await s.orch.resultVectors([{ chunk_id: MISSING_CHUNK_ID }, results[0]]);
        expect(vectors[0]).toBeNull();
    });
});
