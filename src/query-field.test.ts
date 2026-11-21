// Tests for the pure pill-validation helpers in query-field.ts. The field
// itself (PillQueryField) is a contenteditable DOM component with no jsdom
// environment configured for this suite (see vitest.config.mts) — these tests
// cover only the extracted pure logic, not rendering.

import { describe, it, expect } from 'vitest';
import { propPillNumericError, datePillValue, datePresets, relativeSpanHint, matchingOps, operatorHint, openedAfterPresets, serializePill, pendingCommit, canCommit, isValueSuggestions, withPill, type PillToken } from './query-field';
import { parseQuery } from './query-parser';
import { applyFilterMenuPick, deriveSuggestions, filterMenuRows, menuOwnsKeys, textWithoutCommittedPartial, toggleFilterMenu, type DeriveContext, type FilterMenuRow, type QueryDraft, type SuggestState } from './query-field';
import { SuggestEngine } from './suggest';
import type { SeekerSettings } from './types';

describe('propPillNumericError (audit R2 #10)', () => {
    const numericKeys = new Set(['price']);
    const isNumericKey = (k: string): boolean => numericKeys.has(k);

    it('non-comparison values never error (no leading operator)', () => {
        expect(propPillNumericError('context', 'work', isNumericKey)).toBe(false);
    });

    it('a comparison on a non-Number key errors (existing D3 behavior)', () => {
        expect(propPillNumericError('pageType', '>50', isNumericKey)).toBe(true);
    });

    it('a well-formed comparison on a Number key does not error', () => {
        expect(propPillNumericError('price', '>50', isNumericKey)).toBe(false);
        expect(propPillNumericError('price', '<200', isNumericKey)).toBe(false);
        expect(propPillNumericError('price', '=50.00', isNumericKey)).toBe(false);
    });

    it('an unparseable numeric literal on a Number key errors too (the fix)', () => {
        // Previously this rendered as a healthy pill even though parseNum in
        // query-parser.ts fails on the stray comma, hard-zeroing the query.
        expect(propPillNumericError('price', '>49,99', isNumericKey)).toBe(true);
        expect(propPillNumericError('price', '>abc', isNumericKey)).toBe(true);
    });

    it('no key means no error (defensive)', () => {
        expect(propPillNumericError(undefined, '>50', isNumericKey)).toBe(false);
    });
});

// "Now" for the date-pill tests: local noon 2026-10-30.
const NOW_MS = new Date(2026, 9, 30, 12).getTime();

describe('datePillValue — what an after:/before: pill commits', () => {
    it('a relative span commits as its absolute local date', () => {
        expect(datePillValue('7d', NOW_MS)).toBe('2026-10-23');
    });

    it('an absolute date commits unchanged', () => {
        expect(datePillValue('2026-04', NOW_MS)).toBe('2026-04');
    });

    it('a non-date, non-span value does not commit', () => {
        expect(datePillValue('lastweek', NOW_MS)).toBeNull();
    });

    it('a span reaching past year 1000 does not commit', () => {
        expect(datePillValue('2000y', NOW_MS)).toBeNull();
    });

    it('an unknown span unit does not commit', () => {
        expect(datePillValue('0x', NOW_MS)).toBeNull();
    });
});

describe('datePresets — the after:/before: suggestion rows', () => {
    it('offers last 7 / 30 / 90 days first, as absolute dates', () => {
        expect(datePresets('after', NOW_MS).slice(0, 3)).toEqual([
            { value: '2026-10-23', label: 'last 7 days' },
            { value: '2026-09-30', label: 'last 30 days' },
            { value: '2026-08-01', label: 'last 90 days' },
        ]);
    });

    it('keeps the month and year presets', () => {
        expect(datePresets('after', NOW_MS).slice(3).map(p => p.label)).toEqual(['this month', 'this year', 'last year', '2024']);
    });

    it('labels the day spans as the older side for before:', () => {
        expect(datePresets('before', NOW_MS)[0]).toEqual({ value: '2026-10-23', label: '7+ days ago' });
    });
});

describe('relativeSpanHint', () => {
    it('reads a single unit in the singular', () => {
        expect(relativeSpanHint('after', { count: 1, unit: 'm' })).toBe('last 1 month');
    });

    it('reads a week span for before: as the older side', () => {
        expect(relativeSpanHint('before', { count: 2, unit: 'w' })).toBe('2+ weeks ago');
    });
});

describe('matchingOps — operator-keyword completion', () => {
    it('keeps offering opened-after while typing through the hyphen', () => {
        expect(matchingOps('opened-')).toEqual(['opened-after']);
    });

    it('offers opened-after from its first letter', () => {
        expect(matchingOps('o')).toEqual(['opened-after']);
    });

    it('does not offer opened-after for a word starting with a', () => {
        expect(matchingOps('a')).toEqual(['after']);
    });

    it('offers nothing for a leading-dash negation', () => {
        expect(matchingOps('-op')).toEqual([]);
    });

    it('offers nothing for a hyphenated word that prefixes no operator', () => {
        expect(matchingOps('well-')).toEqual([]);
    });
});

describe('operatorHint', () => {
    it('reads opened-after in plain language without the Recency field name', () => {
        expect(operatorHint('opened-after', 'modified')).toBe('opened on/after a date · 7d = last 7 days');
    });

    it('still prefixes after: with the Recency field name', () => {
        expect(operatorHint('after', 'modified')).toBe('modified on/after a date · 7d = last 7 days');
    });
});

describe('openedAfterPresets — the opened-after: suggestion rows', () => {
    it('offers today, last 7 days and last 30 days as absolute dates', () => {
        expect(openedAfterPresets(NOW_MS)).toEqual([
            { value: '2026-10-30', label: 'today' },
            { value: '2026-10-23', label: 'last 7 days' },
            { value: '2026-09-30', label: 'last 30 days' },
        ]);
    });
});

describe('serializePill — an opened-after: pill round-trips through the parser', () => {
    it('a committed opened-after pill re-parses as the same opened-after bound', () => {
        const value = openedAfterPresets(NOW_MS)[0].value;
        expect(parseQuery(serializePill({ op: 'opened-after', value })).filters!.openedAfter).toBe(value);
    });
});

describe('is: operator — the folder-note filter in the query field', () => {
    it('offers the is: operator while typing "is"', () => {
        expect(matchingOps('is')).toEqual(['is']);
    });

    it('gives the is: operator a plain-language hint', () => {
        expect(operatorHint('is', 'modified')).toBe('filter by note kind · folder notes');
    });

    it('at "is:" offers the folder-note value row with a shape hint', () => {
        expect(isValueSuggestions('')).toEqual([{ value: 'folder-note', label: 'folder notes · e.g. Alpha/Alpha.md' }]);
    });

    it('a partial value narrows the rows case-insensitively', () => {
        expect(isValueSuggestions('FOLD').map(s => s.value)).toEqual(['folder-note']);
    });

    it('an unknown value offers no row', () => {
        expect(isValueSuggestions('banana')).toEqual([]);
    });

    it('a typed is:folder-note is a pending is pill', () => {
        expect(pendingCommit('is:folder-note')).toEqual({ op: 'is', value: 'folder-note' });
    });

    it('is:folder-note may commit as a pill', () => {
        expect(canCommit('is', 'folder-note', NOW_MS)).toBe(true);
    });

    it('a differently-cased is:Folder-Note may commit too', () => {
        expect(canCommit('is', 'Folder-Note', NOW_MS)).toBe(true);
    });

    it('an unknown is: value does not commit (stays text)', () => {
        expect(canCommit('is', 'banana', NOW_MS)).toBe(false);
    });

    it('a committed is pill re-parses as the folder-note filter', () => {
        expect(parseQuery(serializePill({ op: 'is', value: 'folder-note' })).filters!.folderNote).toBe(true);
    });

    it('committing is:folder-note when its pill is already present leaves exactly one', () => {
        const existing: PillToken[] = [{ op: 'is', value: 'folder-note' }];
        expect(withPill(existing, { op: 'is', value: 'folder-note' })).toEqual(existing);
    });

    it('other pills still append duplicates (unchanged behaviour)', () => {
        const existing: PillToken[] = [{ op: 'tag', value: 'work' }];
        expect(withPill(existing, { op: 'tag', value: 'work' })).toHaveLength(2);
    });
});

// ---- Filter menu (the search icon's "Add filter" menu) ----

// Minimal fake of the App surface SuggestEngine.build() reads (same shape as
// suggest.test.ts's fakeApp): one tag and one note with a `status` property, so
// the value step after a menu pick has real rows to show.
function filterMenuSuggester(): SuggestEngine {
    const file = { path: 'Projects/plan.md', parent: { path: 'Projects' } };
    const app = {
        metadataTypeManager: { getAllProperties: () => ({}) },
        metadataCache: {
            getTags: () => ({ '#work': 3 }),
            getFileCache: () => ({ frontmatter: { status: 'draft' }, tags: [{ tag: '#work' }] }),
        },
        vault: { getMarkdownFiles: () => [file], getConfig: () => [] },
    } as unknown as Parameters<SuggestEngine['build']>[0];
    return new SuggestEngine().build(app, { honorIgnoredFolders: false } as unknown as SeekerSettings);
}

describe('filter menu — rows offered', () => {
    it('lists the filters in order, plain-language label first', () => {
        expect(filterMenuRows('created').map(r => r.label)).toEqual([
            'Tag', 'Folder', 'Property', 'Created on/after', 'Created on/before', 'Opened on/after', 'Folder notes only',
        ]);
    });

    it('shows the syntax each row stands for', () => {
        expect(filterMenuRows('created').map(r => r.syntax)).toEqual([
            'tag:', 'path:', '[key:value]', 'after:', 'before:', 'opened-after:', 'is:folder-note',
        ]);
    });

    it('labels the date rows with the vault\'s own date field', () => {
        expect(filterMenuRows('modified')[3].label).toBe('Modified on/after');
    });
});

describe('filter menu — picking a row', () => {
    const rows = filterMenuRows('created');
    const row = (label: string): FilterMenuRow => rows.find(r => r.label === label)!;
    const ctx = (): DeriveContext => ({ suggester: filterMenuSuggester(), dateFieldLabel: 'created', nowMs: NOW_MS });

    describe('GIVEN "meeting notes" typed', () => {
        const typed: QueryDraft = { text: 'meeting notes', tokens: [] };

        it('WHEN Tag is picked THEN tag: starts as a new token after the typed text', () => {
            expect(applyFilterMenuPick(typed, row('Tag')).text).toBe('meeting notes tag:');
        });

        it('WHEN Tag is picked THEN the tag value menu shows', () => {
            const d = deriveSuggestions(applyFilterMenuPick(typed, row('Tag')).text, ctx());
            expect(d.sugg.items.map(i => i.label)).toEqual(['#work']);
        });

        it('WHEN Tag then a tag is picked THEN the typed text is kept beside the pill', () => {
            expect(textWithoutCommittedPartial(`${applyFilterMenuPick(typed, row('Tag')).text}work`, 'tag')).toBe('meeting notes ');
        });

        it('WHEN Property is picked THEN the property-key menu shows', () => {
            const d = deriveSuggestions(applyFilterMenuPick(typed, row('Property')).text, ctx());
            expect(d.sugg.items.map(i => i.label)).toEqual(['[status:']);
        });

        it('WHEN Property then a value is picked THEN the typed text is kept beside the pill', () => {
            expect(textWithoutCommittedPartial(`${applyFilterMenuPick(typed, row('Property')).text}status:draft`, 'prop')).toBe('meeting notes ');
        });

        it('WHEN a date row is picked THEN the date presets show', () => {
            const d = deriveSuggestions(applyFilterMenuPick(typed, row('Created on/after')).text, ctx());
            expect(d.sugg.items.map(i => i.hint)).toContain('last 7 days');
        });

        it('WHEN Folder notes only is picked THEN the is:folder-note pill is added', () => {
            expect(applyFilterMenuPick(typed, row('Folder notes only')).tokens).toEqual([{ op: 'is', value: 'folder-note' }]);
        });

        it('WHEN Folder notes only is picked THEN the typed text is untouched', () => {
            expect(applyFilterMenuPick(typed, row('Folder notes only')).text).toBe('meeting notes');
        });
    });

    it('GIVEN empty text WHEN Folder is picked THEN the text is just path:', () => {
        expect(applyFilterMenuPick({ text: '', tokens: [] }, row('Folder')).text).toBe('path:');
    });

    it('GIVEN text ending in a space WHEN Tag is picked THEN no second space is added', () => {
        expect(applyFilterMenuPick({ text: 'notes ', tokens: [] }, row('Tag')).text).toBe('notes tag:');
    });

    it('GIVEN the folder-note pill present WHEN Folder notes only is picked THEN it is not duplicated', () => {
        const existing: PillToken[] = [{ op: 'is', value: 'folder-note' }];
        expect(applyFilterMenuPick({ text: '', tokens: existing }, row('Folder notes only')).tokens).toEqual(existing);
    });
});

describe('filter menu — open/close toggling', () => {
    const closed: SuggestState = { open: false, kind: 'op', items: [], active: 0 };

    it('GIVEN no menu WHEN the icon is clicked THEN the filter menu opens', () => {
        expect(toggleFilterMenu(closed, 'created').kind).toBe('filter');
    });

    it('GIVEN the filter menu WHEN the icon is clicked again THEN it closes', () => {
        expect(toggleFilterMenu(toggleFilterMenu(closed, 'created'), 'created').open).toBe(false);
    });

    it('GIVEN an operator hint open WHEN the icon is clicked THEN the filter menu replaces it', () => {
        const opHint: SuggestState = { open: true, kind: 'op', items: [{ type: 'op', label: 'tag:', hint: '', opKey: 'tag' }], active: 0 };
        expect(toggleFilterMenu(opHint, 'created').kind).toBe('filter');
    });

    it('GIVEN the filter menu just opened THEN arrows/Enter act on it without hovering first', () => {
        expect(menuOwnsKeys(toggleFilterMenu(closed, 'created'), false)).toBe(true);
    });

    it('GIVEN an unengaged operator hint THEN arrows/Enter are not hijacked (unchanged)', () => {
        const opHint: SuggestState = { open: true, kind: 'op', items: [{ type: 'op', label: 'tag:', hint: '', opKey: 'tag' }], active: 0 };
        expect(menuOwnsKeys(opHint, false)).toBe(false);
    });
});
