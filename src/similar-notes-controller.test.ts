// Unit tests for the similar-notes panel's gating/stale-drop/debounce logic
// (similar-notes-controller.ts). Deps are hand-rolled fakes: a controllable
// query promise per call and a manual timer, so every ordering is explicit.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    INDEX_CHANGED_DEBOUNCE_MS, SimilarNotesController, needsRefresh,
    type SimilarNotesEmptyReason, type SimilarNotesState,
} from './similar-notes-controller';
import type { ScoredChunk } from './types';

const A = 'A.md';
const B = 'B.md';

function result(notePath: string): ScoredChunk {
    return { note_path: notePath } as unknown as ScoredChunk;
}

interface PendingQuery {
    notePath: string;
    resolve(results: ScoredChunk[]): void;
    reject(e: unknown): void;
}

class Fakes {
    queries: PendingQuery[] = [];
    rendered: SimilarNotesState[] = [];
    scheduled: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    failures: unknown[] = [];
    emptyReason: SimilarNotesEmptyReason = 'none-similar';
    readonly controller = new SimilarNotesController({
        similarNotes: notePath => new Promise((resolve, reject) => { this.queries.push({ notePath, resolve, reject }); }),
        emptyReason: async () => this.emptyReason,
        mode: () => 'best-chunk',
        render: state => { this.rendered.push(state); },
        schedule: (fn, ms) => {
            const entry = { fn, ms, cancelled: false };
            this.scheduled.push(entry);
            return () => { entry.cancelled = true; };
        },
        reportFailure: e => { this.failures.push(e); },
    });

    queriedPaths(): string[] {
        return this.queries.map(q => q.notePath);
    }

    lastRendered(): SimilarNotesState | undefined {
        return this.rendered[this.rendered.length - 1];
    }

    // Resolve the pending query #i and let the controller's continuation run.
    async answer(i: number, results: ScoredChunk[]): Promise<void> {
        this.queries[i].resolve(results);
        await flush();
    }

    fireTimers(): void {
        const due = this.scheduled.filter(t => !t.cancelled);
        this.scheduled = [];
        for (const t of due) t.fn();
    }
}

// Two microtask turns: similarNotes → (emptyReason →) render.
async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('needsRefresh — the gating decision', () => {
    it('is false while hidden even when the note changed', () => {
        expect(needsRefresh({ visible: false, activePath: A, shownPath: null, stale: true })).toBe(false);
    });

    it('is false with no active note', () => {
        expect(needsRefresh({ visible: true, activePath: null, shownPath: null, stale: true })).toBe(false);
    });

    it('is true when visible and the active note is not the shown one', () => {
        expect(needsRefresh({ visible: true, activePath: B, shownPath: A, stale: false })).toBe(true);
    });

    it('is false when visible and the shown note is current and fresh', () => {
        expect(needsRefresh({ visible: true, activePath: A, shownPath: A, stale: false })).toBe(false);
    });

    it('is true when the shown note is current but stale (index or mode changed)', () => {
        expect(needsRefresh({ visible: true, activePath: A, shownPath: A, stale: true })).toBe(true);
    });
});

describe('GIVEN a hidden panel', () => {
    let f: Fakes;
    beforeEach(() => { f = new Fakes(); });

    it('WHEN the active note changes THEN nothing is queried', () => {
        f.controller.setActiveNote(A);
        expect(f.queriedPaths()).toEqual([]);
    });

    it('WHEN notes change while hidden and the panel then shows THEN only the latest note is queried', () => {
        f.controller.setActiveNote(A);
        f.controller.setActiveNote(B);
        f.controller.setVisible(true);
        expect(f.queriedPaths()).toEqual([B]);
    });

    it('WHEN it shows with no active note THEN the no-note state is painted without a query', () => {
        f.controller.setVisible(true);
        expect(f.lastRendered()).toEqual({ kind: 'no-note' });
        expect(f.queriedPaths()).toEqual([]);
    });
});

describe('GIVEN a visible panel showing note A', () => {
    let f: Fakes;
    beforeEach(async () => {
        f = new Fakes();
        f.controller.setVisible(true);
        f.controller.setActiveNote(A);
        await f.answer(0, [result(B)]);
    });

    it('THEN the results state for A is painted', () => {
        expect(f.lastRendered()).toEqual({ kind: 'results', notePath: A, results: [result(B)] });
    });

    it('WHEN it hides and shows again with the same note THEN no new query runs', () => {
        f.controller.setVisible(false);
        f.controller.setVisible(true);
        expect(f.queriedPaths()).toEqual([A]);
    });

    it('WHEN the note changes while hidden THEN showing re-queries for the new note', () => {
        f.controller.setVisible(false);
        f.controller.setActiveNote(B);
        expect(f.queriedPaths()).toEqual([A]);
        f.controller.setVisible(true);
        expect(f.queriedPaths()).toEqual([A, B]);
    });

    it('WHEN the active note goes away THEN the no-note state is painted', () => {
        f.controller.setActiveNote(null);
        expect(f.lastRendered()).toEqual({ kind: 'no-note' });
    });

    it('WHEN the mode changes THEN the same note is re-queried', () => {
        f.controller.modeChanged();
        expect(f.queriedPaths()).toEqual([A, A]);
    });
});

describe('GIVEN the user switches from A to B while A is still loading (latest wins)', () => {
    let f: Fakes;
    beforeEach(() => {
        f = new Fakes();
        f.controller.setVisible(true);
        f.controller.setActiveNote(A);
        f.controller.setActiveNote(B);
    });

    it('WHEN the stale A answer arrives after B THEN only B is painted', async () => {
        await f.answer(1, [result('b-hit.md')]);
        await f.answer(0, [result('a-hit.md')]);
        const painted = f.rendered.filter(s => s.kind === 'results');
        expect(painted).toEqual([{ kind: 'results', notePath: B, results: [result('b-hit.md')] }]);
    });

    it('WHEN the stale A query fails THEN no error is painted or reported', async () => {
        f.queries[0].reject(new Error('late failure'));
        await flush();
        expect(f.failures).toEqual([]);
        expect(f.rendered.some(s => s.kind === 'error')).toBe(false);
    });

    it('WHEN the panel hides mid-query and the answer arrives THEN it is dropped and showing re-queries', async () => {
        f.controller.setVisible(false);
        await f.answer(1, [result('b-hit.md')]);
        expect(f.rendered.some(s => s.kind === 'results')).toBe(false);
        f.controller.setVisible(true);
        expect(f.queriedPaths()).toEqual([A, B, B]);
    });
});

describe('GIVEN a visible panel and a reindex firing many index-changed signals', () => {
    let f: Fakes;
    beforeEach(async () => {
        f = new Fakes();
        f.controller.setVisible(true);
        f.controller.setActiveNote(A);
        await f.answer(0, [result(B)]);
        for (let i = 0; i < 5; i++) f.controller.indexChanged();
    });

    it('THEN no re-query runs before the debounce elapses', () => {
        expect(f.queriedPaths()).toEqual([A]);
    });

    it('THEN one timer is armed with the debounce delay', () => {
        expect(f.scheduled.map(t => t.ms)).toEqual([INDEX_CHANGED_DEBOUNCE_MS]);
    });

    it('WHEN the debounce elapses THEN exactly one re-query runs', () => {
        f.fireTimers();
        expect(f.queriedPaths()).toEqual([A, A]);
    });

    it('WHEN the debounce elapses while hidden THEN showing again re-queries once', () => {
        f.controller.setVisible(false);
        f.fireTimers();
        expect(f.queriedPaths()).toEqual([A]);
        f.controller.setVisible(true);
        expect(f.queriedPaths()).toEqual([A, A]);
    });

    it('WHEN disposed before the debounce elapses THEN the timer is cancelled', () => {
        f.controller.dispose();
        expect(f.scheduled.every(t => t.cancelled)).toBe(true);
    });
});

describe('GIVEN a query that returns nothing', () => {
    let f: Fakes;
    beforeEach(() => {
        f = new Fakes();
        f.controller.setVisible(true);
    });

    it.each<SimilarNotesEmptyReason>(['no-index', 'not-indexed', 'none-similar'])(
        'WHEN the reason is %s THEN that state is painted for the note', async reason => {
            f.emptyReason = reason;
            f.controller.setActiveNote(A);
            await f.answer(0, []);
            expect(f.lastRendered()).toEqual({ kind: reason, notePath: A });
        },
    );

    it('WHEN the query throws THEN the failure is reported and the error state painted', async () => {
        f.controller.setActiveNote(A);
        f.queries[0].reject(new Error('boom'));
        await flush();
        expect(f.failures).toHaveLength(1);
        expect(f.lastRendered()).toEqual({ kind: 'error', notePath: A });
    });
});
