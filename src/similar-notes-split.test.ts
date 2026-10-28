// Pure parts of the similar-notes graph/list divider: the drag decision and the
// persisted-share repair. The DOM handle is covered by the real-Obsidian e2e (e6d
// in e2e/search.e2e.ts).

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_LIST_SHARE, MIN_GRAPH_HEIGHT_PX, MIN_LIST_HEIGHT_PX,
    listShareFromPersisted, splitForListHeight,
} from './similar-notes-split';

describe('splitForListHeight', () => {
    // GIVEN a panel tall enough for both minimums with room to spare, and a share kept from before
    const TOTAL = 800;
    const KEPT_SHARE = 0.4;

    it('sets the share from a list height between the two limits', () => {
        expect(splitForListHeight(200, TOTAL, KEPT_SHARE)).toEqual({ collapsed: false, share: 0.25 });
    });

    it('keeps the list at exactly its minimum height', () => {
        expect(splitForListHeight(MIN_LIST_HEIGHT_PX, TOTAL, KEPT_SHARE)).toEqual({ collapsed: false, share: 0.08 });
    });

    it('hides the list when dragged shorter than its minimum', () => {
        expect(splitForListHeight(MIN_LIST_HEIGHT_PX - 1, TOTAL, KEPT_SHARE).collapsed).toBe(true);
    });

    it('keeps the earlier share while hidden, so showing the list restores it', () => {
        expect(splitForListHeight(0, TOTAL, KEPT_SHARE).share).toBe(KEPT_SHARE);
    });

    it('hides the list when dragged past the bottom (negative height)', () => {
        expect(splitForListHeight(-50, TOTAL, KEPT_SHARE).collapsed).toBe(true);
    });

    it('stops the list where the graph would drop below its minimum', () => {
        expect(splitForListHeight(TOTAL, TOTAL, KEPT_SHARE).share).toBe((TOTAL - MIN_GRAPH_HEIGHT_PX) / TOTAL);
    });

    it('stops the list at the graph minimum when dragged past the top', () => {
        expect(splitForListHeight(TOTAL * 2, TOTAL, KEPT_SHARE).share).toBe((TOTAL - MIN_GRAPH_HEIGHT_PX) / TOTAL);
    });

    it('rounds the share to three decimals', () => {
        expect(splitForListHeight(300, 900, KEPT_SHARE).share).toBe(0.333);
    });

    it('gives the list its minimum when the panel cannot fit both minimums', () => {
        const cramped = MIN_GRAPH_HEIGHT_PX;
        expect(splitForListHeight(cramped, cramped, KEPT_SHARE).share).toBe(MIN_LIST_HEIGHT_PX / cramped);
    });

    it('never reaches a share of 1, even on a panel shorter than the list minimum', () => {
        expect(splitForListHeight(MIN_LIST_HEIGHT_PX, MIN_LIST_HEIGHT_PX / 2, KEPT_SHARE).share).toBeLessThan(1);
    });

    it('leaves the split alone on a panel with no height', () => {
        expect(splitForListHeight(MIN_LIST_HEIGHT_PX, 0, KEPT_SHARE)).toEqual({ collapsed: false, share: KEPT_SHARE });
    });
});

describe('listShareFromPersisted', () => {
    it('keeps a share inside (0, 1)', () => {
        expect(listShareFromPersisted(0.3)).toBe(0.3);
    });

    it('defaults when never persisted (older install)', () => {
        expect(listShareFromPersisted(undefined)).toBe(DEFAULT_LIST_SHARE);
    });

    it('defaults a non-numeric value', () => {
        expect(listShareFromPersisted('0.3')).toBe(DEFAULT_LIST_SHARE);
    });

    it('defaults NaN', () => {
        expect(listShareFromPersisted(Number.NaN)).toBe(DEFAULT_LIST_SHARE);
    });

    it('defaults a share of 0 (that is the hidden flag\'s job, not the share\'s)', () => {
        expect(listShareFromPersisted(0)).toBe(DEFAULT_LIST_SHARE);
    });

    it('defaults a share of 1 (no room for the graph)', () => {
        expect(listShareFromPersisted(1)).toBe(DEFAULT_LIST_SHARE);
    });
});
