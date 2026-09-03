// The image gate + pure decode-resize plan + OCR-queue comparator (image-file.ts).
// Pure and Obsidian-free; these numbers are the §12 D4 / §13 spike constants.
import { describe, it, expect } from 'vitest';
import {
    isIndexableImageExtension, isIndexableImagePath, isSkippedImageExtension,
    planResize, compareOcrQueue, PIXEL_CAP,
    RESIZE_MIN_LONG_EDGE_PX, RESIZE_MAX_LONG_EDGE_PX, type OcrQueueItem,
} from './image-file';

describe('image extension gate (§12 D3)', () => {
    it('accepts a V1 raster format', () => {
        expect(isIndexableImageExtension('png')).toBe(true);
    });

    it('accepts regardless of letter case', () => {
        expect(isIndexableImageExtension('JPEG')).toBe(true);
    });

    it('rejects svg (needs XML text extraction, not OCR)', () => {
        expect(isIndexableImageExtension('svg')).toBe(false);
    });

    it('counts svg / heic as skipped (shown on the status card, not indexed)', () => {
        expect(isSkippedImageExtension('svg')).toBe(true);
        expect(isSkippedImageExtension('heic')).toBe(true);
    });

    it('matches on a full path', () => {
        expect(isIndexableImagePath('Attachments/Whiteboard.PNG')).toBe(true);
        expect(isIndexableImagePath('note.md')).toBe(false);
    });
});

describe('planResize window + pixel cap (§12 D4, §13)', () => {
    it('upscales a small screenshot to the 2000 px long edge', () => {
        expect(planResize(1000, 800)).toEqual({ scale: 2, targetW: 2000, targetH: 1600 });
    });

    it('leaves an image already inside the window untouched', () => {
        expect(planResize(2500, 1500)).toEqual({ scale: 1, targetW: 2500, targetH: 1500 });
    });

    it('downscales a large scan to the 3000 px long edge', () => {
        expect(planResize(6000, 3000)).toEqual({ scale: 0.5, targetW: 3000, targetH: 1500 });
    });

    it('rejects an image above the 25 MP pixel cap', () => {
        expect(planResize(20000, 8000)).toEqual({ reject: 'pixel-cap' });
    });

    it('allows an image exactly at the cap', () => {
        expect(planResize(5000, 5000)).not.toHaveProperty('reject');
    });

    it('pins the constants the spike measured', () => {
        expect([RESIZE_MIN_LONG_EDGE_PX, RESIZE_MAX_LONG_EDGE_PX, PIXEL_CAP]).toEqual([2000, 3000, 25_000_000]);
    });
});

describe('compareOcrQueue (§9 Q1: referenced first, then most-recent first)', () => {
    const q = (over: Partial<OcrQueueItem>): OcrQueueItem => ({ path: 'x.png', mtimeMs: 0, referenced: false, ...over });

    it('orders a referenced image before an unreferenced one', () => {
        const sorted = [q({ path: 'a', referenced: false, mtimeMs: 999 }), q({ path: 'b', referenced: true, mtimeMs: 1 })].sort(compareOcrQueue);
        expect(sorted.map(i => i.path)).toEqual(['b', 'a']);
    });

    it('orders most-recent first within the same reference group', () => {
        const sorted = [q({ path: 'old', mtimeMs: 100 }), q({ path: 'new', mtimeMs: 900 })].sort(compareOcrQueue);
        expect(sorted.map(i => i.path)).toEqual(['new', 'old']);
    });
});
