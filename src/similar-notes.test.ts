import { describe, it, expect } from 'vitest';
import {
    averageUnitVector, sampleEvenly, sourceRowsOf, scannedSourceRows, similarityQueries,
    rankSimilarNotes, toSimilarResult, MAX_SOURCE_CHUNKS_SCANNED, type SimilarCandidate,
} from './similar-notes';
import type { ChunkMeta } from './types';

// Axis-aligned unit vectors make every cosine exact and hand-checkable.
const DIM = 4;
function vec(...xs: number[]): Float32Array {
    const v = new Float32Array(DIM);
    xs.forEach((x, i) => { v[i] = x; });
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n);
    return v.map(x => x / n);
}
const TOPIC_A = vec(1, 0, 0, 0);
const TOPIC_B = vec(0, 1, 0, 0);

function chunk(note_path: string, chunk_id: string, extra: Partial<ChunkMeta> = {}): ChunkMeta {
    return {
        chunk_id, note_path, title: note_path, heading_path: [], start_line: 1, end_line: 1,
        metadata: { tags: [], aliases: [], created: null, modified: null, properties: {} },
        ...extra,
    } as ChunkMeta;
}
function candidate(note_path: string, chunk_id: string, vector: Float32Array): SimilarCandidate {
    return { chunk: chunk(note_path, chunk_id), vector };
}
const paths = (hits: { chunk: ChunkMeta }[]): string[] => hits.map(h => h.chunk.note_path);

describe('averageUnitVector', () => {
    it('GIVEN two orthogonal unit vectors WHEN averaged THEN the result is unit length', () => {
        const avg = averageUnitVector([TOPIC_A, TOPIC_B])!;
        expect(Math.hypot(...avg)).toBeCloseTo(1, 6);
    });

    it('GIVEN two orthogonal unit vectors WHEN averaged THEN it points equally between them', () => {
        const avg = averageUnitVector([TOPIC_A, TOPIC_B])!;
        expect(avg[0]).toBeCloseTo(avg[1], 6);
    });

    it('GIVEN no vectors WHEN averaged THEN null', () => {
        expect(averageUnitVector([])).toBeNull();
    });

    it('GIVEN opposite vectors that cancel WHEN averaged THEN null (no direction to search)', () => {
        expect(averageUnitVector([TOPIC_A, vec(-1, 0, 0, 0)])).toBeNull();
    });
});

describe('sampleEvenly', () => {
    it('GIVEN fewer items than the cap WHEN sampled THEN all items are kept in order', () => {
        expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
    });

    it('GIVEN more items than the cap WHEN sampled THEN evenly spaced items from the start are kept', () => {
        expect(sampleEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
    });
});

describe('sourceRowsOf', () => {
    const chunks = [
        chunk('Other.md', 'o1'),
        chunk('Src.md', 's2', { start_line: 20 }),
        chunk('Src.md', 's1', { start_line: 1 }),
        chunk('Src.md', 'dead', { start_line: 5 }),
        chunk('Src.md', 'titleOnly', { start_line: 9, lexicalOnly: true }),
    ];
    const validRows = [true, true, true, false, true];

    it('GIVEN a frame WHEN the source rows are picked THEN only the note\'s live, embeddable rows remain, in document order', () => {
        expect(sourceRowsOf(chunks, validRows, 'Src.md')).toEqual([2, 1]);
    });

    it('GIVEN a note absent from the frame WHEN the source rows are picked THEN none', () => {
        expect(sourceRowsOf(chunks, validRows, 'Missing.md')).toEqual([]);
    });
});

describe('scannedSourceRows', () => {
    const manyRows = Array.from({ length: MAX_SOURCE_CHUNKS_SCANNED * 3 }, (_, i) => i);

    it('GIVEN a note longer than the cap WHEN best-chunk mode THEN only the cap is scanned', () => {
        expect(scannedSourceRows('best-chunk', manyRows)).toHaveLength(MAX_SOURCE_CHUNKS_SCANNED);
    });

    it('GIVEN a note longer than the cap WHEN average mode THEN every chunk feeds the average', () => {
        expect(scannedSourceRows('average', manyRows)).toEqual(manyRows);
    });
});

describe('similarityQueries', () => {
    it('GIVEN two source vectors WHEN best-chunk mode THEN each is its own query', () => {
        expect(similarityQueries('best-chunk', [TOPIC_A, TOPIC_B])).toEqual([TOPIC_A, TOPIC_B]);
    });

    it('GIVEN two source vectors WHEN average mode THEN one averaged query', () => {
        expect(similarityQueries('average', [TOPIC_A, TOPIC_B])).toHaveLength(1);
    });

    it('GIVEN no source vectors WHEN average mode THEN no queries', () => {
        expect(similarityQueries('average', [])).toEqual([]);
    });
});

describe('rankSimilarNotes', () => {
    it('GIVEN a closer and a farther note WHEN ranked THEN the closer note is first', () => {
        const hits = rankSimilarNotes([TOPIC_A], [
            candidate('Far.md', 'f1', vec(1, 0, 3, 0)),
            candidate('Close.md', 'c1', vec(3, 0, 1, 0)),
        ], 10);
        expect(paths(hits)).toEqual(['Close.md', 'Far.md']);
    });

    it('GIVEN a note with several matching chunks WHEN ranked THEN it appears once', () => {
        const hits = rankSimilarNotes([TOPIC_A], [
            candidate('Multi.md', 'm1', vec(1, 1, 0, 0)),
            candidate('Multi.md', 'm2', vec(3, 1, 0, 0)),
        ], 10);
        expect(paths(hits)).toEqual(['Multi.md']);
    });

    it('GIVEN a note with several chunks WHEN ranked THEN its result is its best-matching chunk', () => {
        const hits = rankSimilarNotes([TOPIC_A], [
            candidate('Multi.md', 'm1', vec(1, 1, 0, 0)),
            candidate('Multi.md', 'm2', vec(3, 1, 0, 0)),
        ], 10);
        expect(hits[0].chunk.chunk_id).toBe('m2');
    });

    it('GIVEN two queries WHEN ranked THEN a candidate scores its max cosine over the queries', () => {
        const hits = rankSimilarNotes([TOPIC_A, TOPIC_B], [candidate('B.md', 'b1', TOPIC_B)], 10);
        expect(hits[0].score).toBeCloseTo(1, 6);
    });

    it('GIVEN more notes than topK WHEN ranked THEN only topK are returned', () => {
        const hits = rankSimilarNotes([TOPIC_A], [
            candidate('A.md', 'a', TOPIC_A), candidate('B.md', 'b', TOPIC_A), candidate('C.md', 'c', TOPIC_A),
        ], 2);
        expect(hits).toHaveLength(2);
    });

    it('GIVEN no queries WHEN ranked THEN empty', () => {
        expect(rankSimilarNotes([], [candidate('A.md', 'a', TOPIC_A)], 10)).toEqual([]);
    });
});

// A two-topic source note (one section on A, one on B). `OneTopic` matches
// topic A exactly; `Blend` covers both topics in one chunk. Best-chunk scores
// OneTopic 1.0 vs Blend ~0.71; the averaged source points between A and B, so
// average scores Blend 1.0 vs OneTopic ~0.71 — the modes disagree.
describe('GIVEN a two-topic source note and a one-topic vs a blended candidate', () => {
    const source = [TOPIC_A, TOPIC_B];
    const candidates = [
        candidate('OneTopic.md', 'one', TOPIC_A),
        candidate('Blend.md', 'blend', vec(1, 1, 0, 0)),
    ];

    it('WHEN best-chunk mode THEN the one-topic note ranks first', () => {
        const hits = rankSimilarNotes(similarityQueries('best-chunk', source), candidates, 10);
        expect(paths(hits)[0]).toBe('OneTopic.md');
    });

    it('WHEN average mode THEN the blended note ranks first', () => {
        const hits = rankSimilarNotes(similarityQueries('average', source), candidates, 10);
        expect(paths(hits)[0]).toBe('Blend.md');
    });
});

describe('toSimilarResult', () => {
    it('GIVEN a hit WHEN shaped as a result THEN its score is the cosine', () => {
        expect(toSimilarResult({ chunk: chunk('A.md', 'a'), score: 0.42 }).score).toBe(0.42);
    });

    it('GIVEN a hit WHEN shaped as a result THEN it carries the best chunk\'s id (resultVectors / cluster graph key)', () => {
        expect(toSimilarResult({ chunk: chunk('A.md', 'a'), score: 0.42 }).chunk_id).toBe('a');
    });
});
