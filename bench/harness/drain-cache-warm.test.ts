// Pins ticket nid_6ndc4i6wlutvwg8obu5m9prtp_e: after reindexAll() + drain(),
// closing the store must NOT surface the benign "BM25 persist failed" warning
// that persistBm25 logs when store.close() lands between its getMeta() read and
// its putBm25() write. Runs the REAL orchestrator + REAL IndexStore on
// fake-indexeddb via the tier-2 scenario harness.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Scenario } from '../../src/test-harness/scenario';
import { CacheWarmDrainer } from './drain-cache-warm';

const PERSIST_FAILED_PREFIX = '[seek] BM25 persist failed';
// fake-indexeddb settles transactions faster than the drainer's poll interval,
// which hides the race; a slow getMeta() (persistBm25's first await) recreates
// the real-browser gap between `warming` clearing and putBm25() starting.
const SLOW_GET_META_MS = 40;
const SETTLE_MS = 100;

function slowDownGetMeta(store: Scenario['store']): void {
    const original = store.getMeta.bind(store);
    store.getMeta = async () => {
        await new Promise(r => setTimeout(r, SLOW_GET_META_MS));
        return original();
    };
}

describe('CacheWarmDrainer', () => {
    afterEach(() => vi.restoreAllMocks());

    it('GIVEN a full reindex WHEN drained and then the store is closed THEN persistBm25 has already completed (no warning)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s = new Scenario();
        await s.boot();
        s.vault.write('a.md', 'alpha beta gamma', 1);
        s.vault.write('b.md', 'delta epsilon zeta', 1);
        slowDownGetMeta(s.store);
        const drainer = new CacheWarmDrainer(s.orch);

        await s.coldStart();
        await drainer.drain();
        s.orch.dispose();
        s.store.close();
        // Let anything still in flight (the bug) reach its warn.
        await new Promise(r => setTimeout(r, SETTLE_MS));

        const persistWarnings = warn.mock.calls.filter(c => typeof c[0] === 'string' && c[0].startsWith(PERSIST_FAILED_PREFIX));
        expect(persistWarnings).toEqual([]);
    });

    it('GIVEN a full reindex WHEN drained THEN the BM25 blob is persisted', async () => {
        const s = new Scenario();
        await s.boot();
        s.vault.write('a.md', 'alpha beta gamma', 1);
        const drainer = new CacheWarmDrainer(s.orch);

        await s.coldStart();
        await drainer.drain();

        expect(await s.store.getBm25()).not.toBeNull();
        await s.teardown();
    });
});
