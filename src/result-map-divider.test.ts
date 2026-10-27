// Pure parts of the list/map divider: the drag clamp and the persisted-width repair.
// The DOM handle is covered by the real-Obsidian e2e (e4 in e2e/search.e2e.ts).

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_LIST_WIDTH_PX, MIN_LIST_WIDTH_PX, MIN_MAP_WIDTH_PX,
    clampListWidth, listWidthFromPersisted,
} from './result-map-divider';

describe('clampListWidth', () => {
    // GIVEN a row wide enough for both minimums with room to spare
    const BODY_WIDTH = 1200;

    it('keeps a width between the two limits', () => {
        expect(clampListWidth(700, BODY_WIDTH)).toBe(700);
    });

    it('stops the list at its minimum', () => {
        expect(clampListWidth(MIN_LIST_WIDTH_PX - 50, BODY_WIDTH)).toBe(MIN_LIST_WIDTH_PX);
    });

    it('stops the list where the map would drop below its minimum', () => {
        expect(clampListWidth(BODY_WIDTH, BODY_WIDTH)).toBe(BODY_WIDTH - MIN_MAP_WIDTH_PX);
    });

    it('rounds a sub-pixel pointer position to whole pixels', () => {
        expect(clampListWidth(700.6, BODY_WIDTH)).toBe(701);
    });

    it('gives the list its minimum when the row cannot fit both minimums', () => {
        expect(clampListWidth(500, MIN_LIST_WIDTH_PX + MIN_MAP_WIDTH_PX - 100)).toBe(MIN_LIST_WIDTH_PX);
    });
});

describe('listWidthFromPersisted', () => {
    it('keeps a saved width', () => {
        expect(listWidthFromPersisted(720)).toBe(720);
    });

    it('keeps a saved width wider than any default window (the CSS clamps it per window)', () => {
        expect(listWidthFromPersisted(2000)).toBe(2000);
    });

    it('falls back to the default when nothing was saved', () => {
        expect(listWidthFromPersisted(undefined)).toBe(DEFAULT_LIST_WIDTH_PX);
    });

    it('falls back to the default for a non-number', () => {
        expect(listWidthFromPersisted('720')).toBe(DEFAULT_LIST_WIDTH_PX);
    });

    it('falls back to the default for NaN', () => {
        expect(listWidthFromPersisted(Number.NaN)).toBe(DEFAULT_LIST_WIDTH_PX);
    });

    it('falls back to the default below the list minimum', () => {
        expect(listWidthFromPersisted(MIN_LIST_WIDTH_PX - 1)).toBe(DEFAULT_LIST_WIDTH_PX);
    });
});
