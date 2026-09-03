// Model 4/6: query and document text prefixes — Tier-2 scenario through the REAL
// SearchOrchestrator + IndexStore (fake-indexeddb, deterministic embedder).
//
// The claim under test: the active model's docPrefix leads the embed input of
// EVERY indexed chunk, and its queryPrefix leads the query embed — the bytes the
// e5/nomic families need to not silently underperform. The recording fake
// captures the actual strings handed to embedBatch()/embed(), so this asserts the
// real dispatched bytes, not just the resulting vectors.

import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { Scenario } from './test-harness/scenario';
import { ACTIVE_MODEL_SPEC } from './model-registry';
import type { ModelOverride } from './types';

// A model override identical to the shipped default EXCEPT for non-empty prefixes
// (the e5/nomic shape). dim stays 384 so the deterministic 384-d fake and the
// store's default width still line up.
const PREFIXED: ModelOverride = {
    repo: ACTIVE_MODEL_SPEC.repo,
    revision: ACTIVE_MODEL_SPEC.revision,
    dim: ACTIVE_MODEL_SPEC.dim,
    pooling: ACTIVE_MODEL_SPEC.pooling,
    dtype: ACTIVE_MODEL_SPEC.dtype,
    queryPrefix: 'query: ',
    docPrefix: 'passage: ',
};

const open: Scenario[] = [];
afterEach(async () => { for (const s of open.splice(0)) await s.teardown(); });

async function bootIndexed(): Promise<Scenario> {
    const s = new Scenario();
    open.push(s);
    await s.boot({ modelOverride: PREFIXED });
    s.vault.write('Note.md', '## Alpha\n\nthe quick brown fox jumps over the lazy dog', 1000);
    await s.coldStart();
    return s;
}

describe('model text prefixes', () => {
    it('leads every indexed chunk embed input with the docPrefix', async () => {
        const s = await bootIndexed();
        expect(s.embedder.embedBatchCalls.length).toBeGreaterThan(0);
        for (const input of s.embedder.embedBatchCalls) {
            expect(input.startsWith('passage: ')).toBe(true);
        }
    });

    it('leads the query embed with the queryPrefix', async () => {
        const s = await bootIndexed();
        await s.orch.search('brown fox');
        expect(s.embedder.embedCalls.length).toBeGreaterThan(0);
        for (const q of s.embedder.embedCalls) {
            expect(q.startsWith('query: ')).toBe(true);
        }
    });
});
