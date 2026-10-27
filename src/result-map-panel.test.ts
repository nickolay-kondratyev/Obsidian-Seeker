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
    resultMapHasGraph,
} from './result-map-panel';
import { DEFAULT_LIST_WIDTH_PX } from './result-map-divider';
import { MIN_VECTORS_FOR_GRAPH } from './result-cluster-model';

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
        expect(resultMapFits(MIN_WINDOW_WIDTH_FOR_MAP_PX)).toBe(true);
    });

    it('does not fit in a window narrower than the minimum', () => {
        expect(resultMapFits(MIN_WINDOW_WIDTH_FOR_MAP_PX - 1)).toBe(false);
    });

    it('at the minimum window width the map-showing modal still holds the default list and map', () => {
        const modalWidth = MIN_WINDOW_WIDTH_FOR_MAP_PX * MAP_MODAL_VIEWPORT_SHARE;
        expect(modalWidth).toBeGreaterThanOrEqual(DEFAULT_LIST_WIDTH_PX + MIN_DEFAULT_MAP_WIDTH_PX);
    });
});

describe('resultMapHasGraph', () => {
    it('draws a graph at exactly the minimum result count', () => {
        expect(resultMapHasGraph(MIN_VECTORS_FOR_GRAPH)).toBe(true);
    });

    it('shows no graph below the minimum (nothing to compare)', () => {
        expect(resultMapHasGraph(MIN_VECTORS_FOR_GRAPH - 1)).toBe(false);
    });

    it('shows no graph for zero results', () => {
        expect(resultMapHasGraph(0)).toBe(false);
    });
});
