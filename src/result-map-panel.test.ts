// Pure logic of the result map panel (the graph's modal host): when it shows.
// The DOM panel itself has no jsdom here (see vitest.config.mts); the
// real-Obsidian e2e covers rendering.

import { describe, it, expect } from 'vitest';
import {
    MAP_MODAL_VIEWPORT_SHARE,
    MIN_DEFAULT_MAP_WIDTH_PX,
    MIN_WINDOW_WIDTH_FOR_MAP_PX,
    resultMapAvailable,
    resultMapFits,
} from './result-map-panel';
import { DEFAULT_LIST_WIDTH_PX } from './result-map-divider';

const ENOUGH_RESULTS = 10;

describe('resultMapAvailable', () => {
    it('is true on desktop with the setting on', () => {
        expect(resultMapAvailable({ isMobile: false, showResultMap: true })).toBe(true);
    });

    it('is false on mobile even with the setting on', () => {
        expect(resultMapAvailable({ isMobile: true, showResultMap: true })).toBe(false);
    });

    it('is false on desktop with the setting off', () => {
        expect(resultMapAvailable({ isMobile: false, showResultMap: false })).toBe(false);
    });
});

describe('resultMapFits', () => {
    it('fits at exactly the minimum window width', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX, resultCount: ENOUGH_RESULTS })).toBe(true);
    });

    it('does not fit in a window narrower than the minimum', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX - 1, resultCount: ENOUGH_RESULTS })).toBe(false);
    });

    it('does not fit a single result (nothing to compare it with)', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX, resultCount: 1 })).toBe(false);
    });

    it('does not fit zero results', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX, resultCount: 0 })).toBe(false);
    });

    it('at the minimum window width the map-showing modal still holds the default list and map', () => {
        const modalWidth = MIN_WINDOW_WIDTH_FOR_MAP_PX * MAP_MODAL_VIEWPORT_SHARE;
        expect(modalWidth).toBeGreaterThanOrEqual(DEFAULT_LIST_WIDTH_PX + MIN_DEFAULT_MAP_WIDTH_PX);
    });
});
