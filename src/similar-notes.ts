// Note-to-note similarity (the similar-notes panel's core): pure, Obsidian-free
// scoring + aggregation. SearchOrchestrator.similarNotes is the thin wiring that
// reads the source note's stored vectors from the resident frame, runs the
// stage-1 binary scan once per query vector, and hands the candidate union here.
//
// Dense-only by design: BM25 / recency / title boost are QUERY-TEXT signals and
// mean nothing between two notes. Scores are raw cosine (stored vectors are unit
// length), so they are comparable across calls — no per-call min-max.

import { cosineScores } from './ranker';
import type { ChunkMeta, ScoredChunk } from './types';

// How a source note with several chunks becomes query vector(s):
//   best-chunk — every source chunk is its own query; a candidate note scores
//                its best (source chunk, candidate chunk) cosine. Finds notes
//                that match ONE topic of a multi-topic note.
//   average    — the source chunks are averaged into one unit query vector; a
//                candidate scores its best chunk against that. Finds notes about
//                the note AS A WHOLE.
export type SimilarityMode = 'best-chunk' | 'average';

// Ceiling on the source chunks best-chunk mode scans (one stage-1 binary scan +
// one stage-2 cosine pass each). Measured 2026-10-26 in Node/V8, 384-d:
//   binary scan  0.4 ms @5k chunks, 0.8 ms @20k, 1.9 ms @50k
//   stage-2 cosine over the worst-case DISJOINT union (cap × binary pool):
//     cap 8: 4 ms (pool 200) / 15 ms (pool 800); cap 16: 14 / 43 ms; cap 32: 40 / 168 ms
// The rerank grows with cap² (more queries × a bigger union), so 16 keeps the
// worst case under ~50 ms desktop while still covering every section of all but
// very long notes (one chunk per heading section, ≤512 tokens each). On mobile
// (no resident int8 block) the union is an IDB read of up to cap × 200 vectors —
// the real ceiling there. Notes over the cap are sampled evenly (sampleEvenly), so
// a very long note's later topics are still represented, just more sparsely.
// Upgrade path if long notes matter: shrink the per-query binary pool as the cap
// grows (keep cap × pool constant) or cluster the source chunks into ≤cap centroids.
export const MAX_SOURCE_CHUNKS_SCANNED = 16;

// One candidate chunk with its stored vector (unit length, same dim as the queries).
export interface SimilarCandidate {
    chunk: ChunkMeta;
    vector: Float32Array;
}

// One similar note: its best-matching chunk and that chunk's cosine.
export interface SimilarNoteHit {
    chunk: ChunkMeta;
    score: number;
}

// Frame rows of `notePath` usable as similarity sources, in document order.
// Skips tombstoned rows and the lexical-only title fallback (its vector is just
// the title — see Chunk.lexicalOnly — so it would match by name, not content).
export function sourceRowsOf(chunks: readonly ChunkMeta[], validRows: readonly boolean[], notePath: string): number[] {
    const rows: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
        if (validRows[i] && chunks[i].note_path === notePath && !chunks[i].lexicalOnly) rows.push(i);
    }
    return rows.sort((a, b) => chunks[a].start_line - chunks[b].start_line);
}

// The source rows a mode actually reads: best-chunk is capped (one scan each);
// average folds every chunk into one vector, so it reads them all (one scan).
export function scannedSourceRows(mode: SimilarityMode, rows: readonly number[]): number[] {
    return mode === 'best-chunk' ? sampleEvenly(rows, MAX_SOURCE_CHUNKS_SCANNED) : [...rows];
}

// At most `cap` items spread evenly over `items`, order preserved, first item kept.
export function sampleEvenly<T>(items: readonly T[], cap: number): T[] {
    if (items.length <= cap) return [...items];
    return Array.from({ length: cap }, (_, i) => items[Math.floor((i * items.length) / cap)]);
}

// The query vector(s) for `mode` from the source note's chunk vectors.
export function similarityQueries(mode: SimilarityMode, sourceVecs: readonly Float32Array[]): Float32Array[] {
    if (mode === 'best-chunk') return [...sourceVecs];
    const avg = averageUnitVector(sourceVecs);
    return avg ? [avg] : [];
}

// Component-wise mean, re-normalized to unit length (cosine = dot downstream).
// null when there is nothing to average or the vectors cancel out (no direction).
export function averageUnitVector(vecs: readonly Float32Array[]): Float32Array | null {
    if (vecs.length === 0) return null;
    const sum = new Float32Array(vecs[0].length);
    for (const v of vecs) for (let d = 0; d < sum.length; d++) sum[d] += v[d];
    let norm = 0;
    for (const x of sum) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm < Number.EPSILON) return null;
    for (let d = 0; d < sum.length; d++) sum[d] /= norm;
    return sum;
}

// Score each candidate chunk as its max cosine over `queries`, keep the best
// chunk per note, and return the top `topK` notes best-first (ties by path, so
// the order is deterministic).
export function rankSimilarNotes(
    queries: readonly Float32Array[],
    candidates: readonly SimilarCandidate[],
    topK: number,
): SimilarNoteHit[] {
    if (queries.length === 0) return [];
    const vectors = candidates.map(c => c.vector);
    const best = new Float64Array(candidates.length).fill(-Infinity);
    for (const q of queries) {
        const scores = cosineScores(q, vectors);
        for (let i = 0; i < scores.length; i++) if (scores[i] > best[i]) best[i] = scores[i];
    }
    const byNote = new Map<string, SimilarNoteHit>();
    candidates.forEach((c, i) => {
        const prev = byNote.get(c.chunk.note_path);
        if (!prev || best[i] > prev.score) byNote.set(c.chunk.note_path, { chunk: c.chunk, score: best[i] });
    });
    return [...byNote.values()]
        .sort((a, b) => b.score - a.score || comparePaths(a.chunk.note_path, b.chunk.note_path))
        .slice(0, topK);
}

// Plain code-unit order. WHY-NOT localeCompare: it varies by runtime locale,
// and the tie order must be the same on every device.
function comparePaths(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// Shape a hit like a search result so the result-map consumers
// (buildClusterGraph, SearchOrchestrator.resultVectors) take it unchanged.
// content is '' (frame-lite, like rank() output before hydration): the panel
// shows titles only. Dense-only, so dense = hybrid = denseRaw = the cosine and
// the query-text signals are 0.
export function toSimilarResult(hit: SimilarNoteHit): ScoredChunk {
    return {
        ...hit.chunk,
        content: '',
        score: hit.score,
        ranking_signals: { dense: hit.score, bm25: 0, hybrid: hit.score, recency: 0, title_boost: 0, denseRaw: hit.score },
    };
}
