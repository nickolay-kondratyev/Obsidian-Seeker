// Coverage pin for the frozen bench corpus (bench/corpus/README.md).
//
// The perf bench (docs/perf-bench.md) only means something if the corpus keeps
// exercising every index seq bucket and the oversize-section split path. This
// test walks the corpus with the REAL chunker and the REAL embed-input
// composition, so a corpus edit that silently drops a bucket fails here, in
// the default `npm run test`, long before anyone compares bench numbers.
//
// Bucketing uses the char-estimate selectBucket (chars / 4.5) rather than the
// token-exact selectIndexBucket: exact counts need the model tokenizer, which
// is not available in Node. The estimate is what the corpus was tuned against.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MarkdownChunker } from '../src/chunker';
import { embedInput, TOKEN_BUDGET } from '../src/token-budget';
import { SEQ_BUCKETS, selectBucket } from '../src/iframe-runner';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'corpus');

// Guard rails from the corpus ticket (nid_9xdumruajy1oru6nlz6g3y1ag_e).
const MIN_FILES = 280;
const MAX_FILES = 330;
const MIN_CHUNKS_PER_BUCKET = 5;
const MIN_NOTES_WITH_OVERSIZE_SECTION = 20;
// BENCH_FILES=N takes the first N files in sorted order (harness contract);
// the corpus interleaves lengths so a small prefix still spans the ladder.
const SMALL_PREFIX_FILES = 70;
// Mirrors CHARS_PER_TOKEN_EST in token-budget.ts / selectBucket.
const CHARS_PER_TOKEN_EST = 4.5;

interface CorpusNote {
    path: string;
    content: string;
}

function readCorpus(): CorpusNote[] {
    return readdirSync(CORPUS_DIR)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .sort()
        .map((f) => ({ path: f, content: readFileSync(join(CORPUS_DIR, f), 'utf8') }));
}

// Per-bucket chunk counts and per-note oversize flags for a list of notes.
class CorpusCoverage {
    readonly bucketCounts = new Map<number, number>(SEQ_BUCKETS.map((b) => [b, 0]));
    readonly notesWithOversizeSection = new Set<string>();
    totalChunks = 0;

    constructor(notes: CorpusNote[]) {
        const chunker = new MarkdownChunker();
        for (const note of notes) {
            for (const chunk of chunker.chunkContent(note.content, note.path)) {
                const text = embedInput(chunk);
                this.totalChunks++;
                const bucket = selectBucket(text.length);
                this.bucketCounts.set(bucket, (this.bucketCounts.get(bucket) ?? 0) + 1);
                if (text.length / CHARS_PER_TOKEN_EST > TOKEN_BUDGET) this.notesWithOversizeSection.add(note.path);
            }
        }
    }

    bucketsBelow(min: number): number[] {
        return SEQ_BUCKETS.filter((b) => (this.bucketCounts.get(b) ?? 0) < min);
    }
}

describe('bench corpus coverage', () => {
    const notes = readCorpus();
    const coverage = new CorpusCoverage(notes);

    it('GIVEN the corpus folder THEN it holds roughly 300 notes', () => {
        expect(notes.length).toBeGreaterThanOrEqual(MIN_FILES);
        expect(notes.length).toBeLessThanOrEqual(MAX_FILES);
    });

    it('GIVEN every note chunked THEN every seq bucket receives at least MIN_CHUNKS_PER_BUCKET chunks', () => {
        expect(coverage.bucketsBelow(MIN_CHUNKS_PER_BUCKET)).toEqual([]);
    });

    it('GIVEN every note chunked THEN at least MIN_NOTES_WITH_OVERSIZE_SECTION notes have a section over the token budget', () => {
        expect(coverage.notesWithOversizeSection.size).toBeGreaterThanOrEqual(MIN_NOTES_WITH_OVERSIZE_SECTION);
    });

    it('GIVEN only the first SMALL_PREFIX_FILES notes (BENCH_FILES contract) THEN every seq bucket is still hit', () => {
        const prefix = new CorpusCoverage(notes.slice(0, SMALL_PREFIX_FILES));
        expect(prefix.bucketsBelow(1)).toEqual([]);
    });
});
