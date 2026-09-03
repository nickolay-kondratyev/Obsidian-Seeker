// batch-sizing.ts is the ONE source for the flush size (search.ts) and the
// warmup grid (embedder.ts). The unit tests pin the module; these pin that both
// consumers actually read BATCH_SIZING — a consumer on a private constant
// would be the un-warmed-shape bug class (SafeInt overflow, cold WGSL compile)
// that the shared module exists to make impossible.
import { describe, it, expect, afterEach } from 'vitest';
import { Scenario } from './test-harness/scenario';
import { BATCH_SIZING, warmupGridFor } from './batch-sizing';
import { indexWarmupGrid } from './embedder';
import { SEQ_BUCKETS } from './iframe-runner';

// Identical short notes → every chunk lands in the smallest seq bucket, where
// the flush size is exactly maxBatch.
function writeShortNotes(s: Scenario, n: number): void {
    for (let i = 0; i < n; i++) s.vault.write(`n${i}.md`, `short note ${i} about tea`, 1000);
}

type FakeEmbedder = { embedBatch: (texts: string[], ...rest: unknown[]) => Promise<unknown> };

describe('BATCH_SIZING is what the indexer flushes with and what the embedder warms', () => {
    let active: Scenario | null = null;
    afterEach(async () => { await active?.teardown(); active = null; });

    it('SearchOrchestrator flushes the smallest bucket at BATCH_SIZING.maxBatch', async () => {
        const s = new Scenario();
        await s.boot();
        active = s;
        writeShortNotes(s, BATCH_SIZING.maxBatch * 2 + 1);
        const sizes: number[] = [];
        const e = s.embedder as unknown as FakeEmbedder;
        const real = e.embedBatch.bind(e);
        e.embedBatch = async (texts, ...rest) => { sizes.push(texts.length); return real(texts, ...rest); };

        await s.orch.reindexAll();

        expect(Math.max(...sizes)).toBe(BATCH_SIZING.maxBatch);
    });

    it('the embedder warms exactly the grid derived from BATCH_SIZING', () => {
        expect(indexWarmupGrid()).toEqual(warmupGridFor(BATCH_SIZING, SEQ_BUCKETS));
    });
});
