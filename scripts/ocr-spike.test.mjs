import { describe, it, expect } from 'vitest';
import { words, wordEditDistance, wordAccuracy, stats } from './ocr-spike.mjs';

describe('words', () => {
    it('GIVEN mixed case + punctuation THEN lowercases and splits on non-alphanumerics', () => {
        expect(words('Math.max(width, height)!')).toEqual(['math', 'max', 'width', 'height']);
    });
    it('GIVEN collapsing whitespace THEN yields no empty tokens', () => {
        expect(words('  a\n\n  b  ')).toEqual(['a', 'b']);
    });
});

describe('wordEditDistance', () => {
    it('GIVEN identical arrays THEN distance 0', () => {
        expect(wordEditDistance(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0);
    });
    it('GIVEN one substitution THEN distance 1', () => {
        expect(wordEditDistance(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1);
    });
    it('GIVEN one insertion (UI-noise word) THEN distance 1', () => {
        expect(wordEditDistance(['a', 'b'], ['a', 'file', 'b'])).toBe(1);
    });
    it('GIVEN empty vs non-empty THEN distance is the other length', () => {
        expect(wordEditDistance([], ['a', 'b'])).toBe(2);
    });
});

describe('wordAccuracy', () => {
    it('GIVEN perfect OCR THEN 1', () => {
        expect(wordAccuracy('the quick brown fox', 'the quick brown fox')).toBe(1);
    });
    it('GIVEN one wrong word of four THEN 0.75', () => {
        expect(wordAccuracy('the quick brown fox', 'the quick brown ox')).toBe(0.75);
    });
    it('GIVEN garbage longer than truth THEN clamps at 0, never negative', () => {
        expect(wordAccuracy('hi', 'zzz qqq www eee rrr')).toBe(0);
    });
    it('GIVEN empty ground truth and empty OCR THEN 1', () => {
        expect(wordAccuracy('', '')).toBe(1);
    });
});

describe('stats', () => {
    it('GIVEN an empty array THEN all quantiles are null', () => {
        expect(stats([])).toMatchObject({ n: 0, min: null, median: null, max: null });
    });
    it('GIVEN a single value THEN min = median = max = that value', () => {
        expect(stats([42])).toMatchObject({ n: 1, min: 42, median: 42, max: 42, mean: 42 });
    });
    it('GIVEN 1..100 THEN the median sits at the p50 rung', () => {
        const xs = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(stats(xs).median).toBe(51);
    });
});
