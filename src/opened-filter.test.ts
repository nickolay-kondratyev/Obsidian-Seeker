// opened-after: through the REAL search path — tier-2 scenario (real
// SearchOrchestrator + IndexStore on fake-indexeddb, FakeVault, deterministic
// embedder), modelled on date-filter.test.ts. Pins what unit tests can't see:
// the matcher reads last-opened times from the store the orchestrator holds
// (setOpenHistory), a search with the filter awaits the store's refresh() first
// (cold start: the history file has not loaded yet), and the filter-only browse
// is most-recently-opened first.

import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Scenario } from './test-harness/scenario';
import type { LastOpenedLookup } from './open-history';

const ONE_DAY_MS = 86_400_000;
// Local noon, so day-granular bounds never sit on a DST/midnight edge.
const NOW_MS = new Date(2026, 9, 30, 12).getTime();
// A token every note shares, so an unfiltered search returns all of them.
const TOKEN = 'zephyrquartz';
const OPENED_TODAY = 'OpenedToday.md';
const OPENED_EARLIER_TODAY = 'OpenedEarlierToday.md';
const OPENED_LAST_WEEK = 'OpenedLastWeek.md';
const NEVER_OPENED = 'NeverOpened.md';

// A store whose in-memory view stays EMPTY until refresh() runs — the shape of
// the real store before its file has loaded.
class FakeOpenHistory implements LastOpenedLookup {
    refreshCalls = 0;
    private view = new Map<string, number>();
    constructor(private readonly persisted: Map<string, number>) {}
    lastOpenedMs(path: string): number | undefined { return this.view.get(path); }
    async refresh(): Promise<void> { this.refreshCalls++; this.view = this.persisted; }
}

let s: Scenario;
let history: FakeOpenHistory;

async function notePaths(query: string): Promise<string[]> {
    const { results } = await s.orch.search(query);
    return results.map(r => r.note_path);
}

describe('GIVEN notes opened today, earlier today, last week, and never — history not yet loaded', () => {
    beforeEach(async () => {
        // Pin the clock buildFilterContext hands the parser so `0d`/`7d` resolve
        // against NOW_MS. Date only: timers stay real for fake-indexeddb.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW_MS);
        s = new Scenario();
        await s.boot({ recencyEpsilon: 0 });
        // Note mtimes run OPPOSITE to open order, so a Recency-date browse and a
        // last-opened browse are distinguishable.
        s.vault.write(OPENED_TODAY, `${TOKEN} alpha`, NOW_MS - 40 * ONE_DAY_MS);
        s.vault.write(OPENED_EARLIER_TODAY, `${TOKEN} beta`, NOW_MS - 30 * ONE_DAY_MS);
        s.vault.write(OPENED_LAST_WEEK, `${TOKEN} gamma`, NOW_MS - 20 * ONE_DAY_MS);
        s.vault.write(NEVER_OPENED, `${TOKEN} delta`, NOW_MS - 10 * ONE_DAY_MS);
        await s.coldStart();
        history = new FakeOpenHistory(new Map([
            [OPENED_TODAY, NOW_MS - 1_000],
            [OPENED_EARLIER_TODAY, NOW_MS - 2 * 3_600_000],
            [OPENED_LAST_WEEK, NOW_MS - 5 * ONE_DAY_MS],
        ]));
        s.orch.setOpenHistory(history);
    });
    afterEach(async () => { await s.teardown(); vi.useRealTimers(); });

    it('WHEN searching opened-after:0d first THEN the notes opened today are listed (refresh awaited)', async () => {
        expect((await notePaths('opened-after:0d')).sort()).toEqual([OPENED_EARLIER_TODAY, OPENED_TODAY]);
    });

    it('WHEN searching opened-after:7d THEN the never-opened note is not listed', async () => {
        expect(await notePaths('opened-after:7d')).not.toContain(NEVER_OPENED);
    });

    it('WHEN searching filter-only opened-after:7d THEN results are most-recently-opened first', async () => {
        expect(await notePaths('opened-after:7d')).toEqual([OPENED_TODAY, OPENED_EARLIER_TODAY, OPENED_LAST_WEEK]);
    });

    it('WHEN searching text + opened-after:7d THEN the ranking matches the text query minus unopened notes', async () => {
        const ranked = await notePaths(TOKEN);
        expect(await notePaths(`${TOKEN} opened-after:7d`)).toEqual(ranked.filter(p => p !== NEVER_OPENED));
    });

    it('WHEN combining opened-after: with after: on the note date THEN both bounds apply', async () => {
        // after:25d keeps the notes modified within 25 days (last week's + never);
        // opened-after:7d then drops the never-opened one.
        expect(await notePaths('opened-after:7d after:25d')).toEqual([OPENED_LAST_WEEK]);
    });

    it('WHEN a filter-only query has no opened-after: THEN it keeps the Recency-date order', async () => {
        expect(await notePaths('after:2026-01-01')).toEqual([NEVER_OPENED, OPENED_LAST_WEEK, OPENED_EARLIER_TODAY, OPENED_TODAY]);
    });

    it('WHEN searching without opened-after: THEN the store refresh is not awaited', async () => {
        await s.orch.search(TOKEN);
        expect(history.refreshCalls).toBe(0);
    });
});

describe('GIVEN no open-history store is wired', () => {
    beforeEach(async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW_MS);
        s = new Scenario();
        await s.boot({ recencyEpsilon: 0 });
        s.vault.write(OPENED_TODAY, `${TOKEN} alpha`, NOW_MS);
        await s.coldStart();
    });
    afterEach(async () => { await s.teardown(); vi.useRealTimers(); });

    it('WHEN searching opened-after:0d THEN nothing matches', async () => {
        expect(await notePaths('opened-after:0d')).toEqual([]);
    });
});
