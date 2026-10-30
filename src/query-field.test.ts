// Tests for the pure pill-validation helpers in query-field.ts. The field
// itself (PillQueryField) is a contenteditable DOM component with no jsdom
// environment configured for this suite (see vitest.config.mts) — these tests
// cover only the extracted pure logic, not rendering.

import { describe, it, expect } from 'vitest';
import { propPillNumericError, datePillValue, datePresets, relativeSpanHint } from './query-field';

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
