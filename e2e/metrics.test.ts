// Unit tests for the pure retrieval metrics (e2e/metrics.ts). BDD GIVEN/WHEN/THEN,
// one assert per test. These pin the maths the aggregate gate depends on, so they
// run in plain `npm run test` (no E2E gate — nothing here touches Chromium).
import { describe, it, expect } from 'vitest';
import { QueryRanking, RetrievalMetrics } from './metrics';

// 1 / log2(3): the discount at rank 2, reused by several expectations below.
const DISCOUNT_RANK_2 = 1 / Math.log2(3);

describe('QueryRanking.ndcgAt', () => {
    it('GIVEN all relevant docs ranked first THEN nDCG@k is 1', () => {
        const q = new QueryRanking(['a', 'b', 'c'], ['a', 'b']);
        expect(q.ndcgAt(3)).toBeCloseTo(1, 10);
    });

    it('GIVEN the one relevant doc at rank 2 THEN nDCG@k is the rank-2 discount', () => {
        const q = new QueryRanking(['a', 'b', 'c'], ['b']);
        expect(q.ndcgAt(3)).toBeCloseTo(DISCOUNT_RANK_2, 10);
    });

    it('GIVEN no relevant doc within k THEN nDCG@k is 0', () => {
        const q = new QueryRanking(['a', 'b', 'c'], ['z']);
        expect(q.ndcgAt(3)).toBe(0);
    });

    it('GIVEN a relevant doc past position k THEN it does not count', () => {
        const q = new QueryRanking(['a', 'b', 'c'], ['c']);
        expect(q.ndcgAt(2)).toBe(0);
    });
});

describe('QueryRanking.recallAt', () => {
    it('GIVEN one of two relevant docs in the top k THEN recall@k is 0.5', () => {
        const q = new QueryRanking(['a', 'x', 'y'], ['a', 'b']);
        expect(q.recallAt(3)).toBe(0.5);
    });

    it('GIVEN a relevant doc past position k THEN it is not counted', () => {
        const q = new QueryRanking(['x', 'y', 'a'], ['a']);
        expect(q.recallAt(2)).toBe(0);
    });
});

describe('QueryRanking.reciprocalRankAt', () => {
    it('GIVEN the first relevant doc at rank 3 THEN RR@k is 1/3', () => {
        const q = new QueryRanking(['x', 'y', 'a', 'b'], ['a', 'b']);
        expect(q.reciprocalRankAt(4)).toBeCloseTo(1 / 3, 10);
    });

    it('GIVEN no relevant doc within k THEN RR@k is 0', () => {
        const q = new QueryRanking(['x', 'y'], ['a']);
        expect(q.reciprocalRankAt(2)).toBe(0);
    });
});

describe('QueryRanking.goldRanks', () => {
    it('GIVEN a relevant doc in the list THEN its 1-based rank is reported', () => {
        const q = new QueryRanking(['x', 'a', 'y'], ['a']);
        expect(q.goldRanks()).toEqual({ a: 2 });
    });

    it('GIVEN a relevant doc absent from the list THEN its rank is null', () => {
        const q = new QueryRanking(['x', 'y'], ['a']);
        expect(q.goldRanks()).toEqual({ a: null });
    });
});

describe('RetrievalMetrics aggregates', () => {
    // q1: relevant at rank 1 (nDCG 1); q2: relevant at rank 2 (nDCG DISCOUNT_RANK_2).
    const ranked = new Map<string, string[]>([
        ['q1', ['a', 'b']],
        ['q2', ['x', 'c']],
    ]);
    const relevant = new Map<string, string[]>([
        ['q1', ['a']],
        ['q2', ['c']],
    ]);

    it('GIVEN two queries THEN meanNdcgAt averages their nDCG', () => {
        const m = new RetrievalMetrics(ranked, relevant);
        expect(m.meanNdcgAt(10)).toBeCloseTo((1 + DISCOUNT_RANK_2) / 2, 10);
    });

    it('GIVEN two queries THEN queryCount is 2', () => {
        const m = new RetrievalMetrics(ranked, relevant);
        expect(m.queryCount).toBe(2);
    });

    it('GIVEN a query id with no ranked list THEN it scores 0, not dropped', () => {
        const m = new RetrievalMetrics(new Map(), relevant);
        expect(m.meanRecallAt(10)).toBe(0);
    });

    it('GIVEN a query id with no ranked list THEN it is still counted', () => {
        const m = new RetrievalMetrics(new Map(), relevant);
        expect(m.queryCount).toBe(2);
    });

    it('GIVEN the queries THEN perQueryGoldRanks reports every query\'s gold ranks', () => {
        const m = new RetrievalMetrics(ranked, relevant);
        expect(m.perQueryGoldRanks()).toEqual({ q1: { a: 1 }, q2: { c: 2 } });
    });
});
