// after:/before: date filters through the REAL search path — tier-2 scenario
// (real SearchOrchestrator + IndexStore on fake-indexeddb, FakeVault mtimes,
// deterministic embedder). Pins what unit tests can't see: the filter reads the
// mtime the indexer stamped (Recency date field = 'modified', the default), it
// works with Recency RANKING off, a relative span (`after:7d`) resolves against
// the search's clock, and it follows an edit through an incremental reindex.

import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Scenario } from './test-harness/scenario';

const ONE_DAY_MS = 86_400_000;
// Local noon, so day-granular bounds never sit on a DST/midnight edge.
const NOW_MS = new Date(2026, 9, 30, 12).getTime();
const RECENT_MTIME = NOW_MS - 3 * ONE_DAY_MS;   // 2026-10-27
const OLD_MTIME = NOW_MS - 60 * ONE_DAY_MS;     // 2026-08-31
// A token both notes share, so an unfiltered search returns both.
const TOKEN = 'zephyrquartz';
const RECENT = 'Recent.md';
const OLD = 'Old.md';

let s: Scenario;

async function notePaths(query: string): Promise<string[]> {
    const { results } = await s.orch.search(query);
    return [...new Set(results.map(r => r.note_path))].sort();
}

describe('GIVEN a recent and an old note sharing a token, Recency ranking OFF', () => {
    beforeEach(async () => {
        // Pin the clock the search call site hands the parser (buildFilterContext's
        // Date.now()) so `after:7d` resolves against NOW_MS. Date only: timers stay
        // real for fake-indexeddb.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW_MS);
        s = new Scenario();
        await s.boot({ recencyEpsilon: 0 });
        s.vault.write(RECENT, `${TOKEN} recent standup`, RECENT_MTIME);
        s.vault.write(OLD, `${TOKEN} old standup`, OLD_MTIME);
        await s.coldStart();
    });
    afterEach(async () => { await s.teardown(); vi.useRealTimers(); });

    it('WHEN searching the token alone THEN both notes are returned (guards the filter tests)', async () => {
        expect(await notePaths(TOKEN)).toEqual([OLD, RECENT]);
    });

    it('WHEN filtering after: an absolute date between them THEN only the recent note is returned', async () => {
        expect(await notePaths(`${TOKEN} after:2026-10-20`)).toEqual([RECENT]);
    });

    it('WHEN filtering before: an absolute date between them THEN only the old note is returned', async () => {
        expect(await notePaths(`${TOKEN} before:2026-10-20`)).toEqual([OLD]);
    });

    it('WHEN filtering after:7d THEN only the note modified 3 days ago is returned', async () => {
        expect(await notePaths(`${TOKEN} after:7d`)).toEqual([RECENT]);
    });

    it('WHEN filtering before:7d THEN only the note modified 60 days ago is returned', async () => {
        expect(await notePaths(`${TOKEN} before:7d`)).toEqual([OLD]);
    });

    it('WHEN the old note is modified today and reindexed THEN after: follows the new mtime', async () => {
        await s.edit(OLD, `${TOKEN} old standup, revisited`, NOW_MS);
        expect(await notePaths(`${TOKEN} after:2026-10-20`)).toEqual([OLD, RECENT]);
    });

    // Deliberate, not a gap: computeDelta only re-indexes a file whose BYTES changed
    // (iCloud/Drive re-stamp mtimes without edits — keyed on mtime alone, iOS re-embeds
    // forever). So `modified` means "content last changed", and a bare touch keeps the
    // indexed date.
    it('WHEN only the old note\'s mtime moves to today (no content change) THEN after: keeps the indexed date', async () => {
        await s.touch(OLD, NOW_MS);
        expect(await notePaths(`${TOKEN} after:2026-10-20`)).toEqual([RECENT]);
    });
});
