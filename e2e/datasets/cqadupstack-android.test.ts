// Pin test for the FROZEN e2e retrieval dataset (e2e/datasets/cqadupstack-android/).
//
// Runs in plain `npm run test` (not gated). It is the AUTHORITATIVE check that
// the committed subset still satisfies the invariants the e2e suite relies on —
// most importantly that every query survives the REAL src/query-parser.ts
// unchanged (the generator can only approximate that with a regex) and that the
// REAL chunker still makes ~one chunk per note (the 1-minute budget assumption).
//
// Constants come from the generator (scripts/build-e2e-dataset.mjs) so the
// numbers live in exactly one place (DRY).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MarkdownChunker } from '../../src/chunker';
import { embedInput } from '../../src/token-budget';
import { parseQuery } from '../../src/query-parser';
import { QUERY_COUNT, TARGET_DOCS, MAX_RELEVANT_PER_QUERY } from '../../scripts/build-e2e-dataset.mjs';

const DATASET_DIR = join(dirname(fileURLToPath(import.meta.url)), 'cqadupstack-android');
const CORPUS_DIR = join(DATASET_DIR, 'corpus');

// ~4 chunks/s wasm -> ~40 s embed, keeps the 1-min container budget. The
// expected value is exactly TARGET_DOCS (MAX_DOC_CHARS caps each note to one
// chunk); the slack absorbs any note that splits. Ticket 2 measures real time.
const MAX_ESTIMATED_CHUNKS = 170;

// Curated must-pass queries need at least this many of EACH kind committed (the
// suite ships 3+ keyword and 3+ semantic passing queries — see the ticket).
const MIN_CURATED_PER_KIND = 3;

interface Query {
    id: string;
    text: string;
    relevant: string[];
}

interface CuratedQuery {
    id: string;
    kind: 'keyword' | 'semantic';
    text: string;
    expectDocId: string;
    maxRank: number;
    rationale: string;
}

function readQueries(): Query[] {
    return JSON.parse(readFileSync(join(DATASET_DIR, 'queries.json'), 'utf8'));
}

function readCurated(): CuratedQuery[] {
    return JSON.parse(readFileSync(join(DATASET_DIR, 'curated-queries.json'), 'utf8'));
}

function readCorpusFiles(): string[] {
    return readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md'));
}

function estimateChunkCount(): number {
    const chunker = new MarkdownChunker();
    let total = 0;
    for (const file of readCorpusFiles()) {
        const content = readFileSync(join(CORPUS_DIR, file), 'utf8');
        for (const chunk of chunker.chunkContent(content, file)) {
            embedInput(chunk); // mirror bench/corpus.test.ts: exercise the real embed-input composition
            total++;
        }
    }
    return total;
}

describe('cqadupstack-android e2e dataset', () => {
    const corpusFiles = readCorpusFiles();
    const queries = readQueries();
    const corpusIds = new Set(corpusFiles.map((f) => f.replace(/\.md$/, '')));

    it('GIVEN the frozen corpus THEN it holds exactly TARGET_DOCS notes', () => {
        expect(corpusFiles.length).toBe(TARGET_DOCS);
    });

    it('GIVEN queries.json THEN it holds exactly QUERY_COUNT queries', () => {
        expect(queries.length).toBe(QUERY_COUNT);
    });

    it('GIVEN every corpus file THEN it is named <numeric id>.md', () => {
        const misnamed = corpusFiles.filter((f) => !/^\d+\.md$/.test(f));
        expect(misnamed).toEqual([]);
    });

    it('GIVEN every corpus file THEN its content starts with "# "', () => {
        const badStart = corpusFiles.filter((f) => !readFileSync(join(CORPUS_DIR, f), 'utf8').startsWith('# '));
        expect(badStart).toEqual([]);
    });

    it('GIVEN every query THEN every relevant id has a corpus file', () => {
        const dangling = queries.flatMap((q) => q.relevant).filter((id) => !corpusIds.has(id));
        expect(dangling).toEqual([]);
    });

    it('GIVEN every query THEN it has 1..MAX_RELEVANT_PER_QUERY relevant ids', () => {
        const outOfRange = queries.filter((q) => q.relevant.length < 1 || q.relevant.length > MAX_RELEVANT_PER_QUERY);
        expect(outOfRange).toEqual([]);
    });

    it('GIVEN the real parseQuery THEN every query text survives with no filters', () => {
        const rewritten = queries.filter((q) => {
            const parsed = parseQuery(q.text);
            return parsed.filters !== null || parsed.cleanedQuery !== q.text;
        });
        expect(rewritten.map((q) => q.text)).toEqual([]);
    });

    it('GIVEN the real chunker THEN the estimated chunk count stays within budget', () => {
        expect(estimateChunkCount()).toBeLessThanOrEqual(MAX_ESTIMATED_CHUNKS);
    });

    describe('curated-queries.json', () => {
        const curated = readCurated();

        it('GIVEN the real parseQuery THEN every curated query survives with no filters', () => {
            const rewritten = curated.filter((q) => {
                const parsed = parseQuery(q.text);
                return parsed.filters !== null || parsed.cleanedQuery !== q.text;
            });
            expect(rewritten.map((q) => q.text)).toEqual([]);
        });

        it('GIVEN every curated query THEN its expectDocId has a corpus file', () => {
            const dangling = curated.filter((q) => !corpusIds.has(q.expectDocId));
            expect(dangling.map((q) => q.expectDocId)).toEqual([]);
        });

        it('GIVEN every curated query THEN its kind is keyword or semantic', () => {
            const bad = curated.filter((q) => q.kind !== 'keyword' && q.kind !== 'semantic');
            expect(bad.map((q) => q.id)).toEqual([]);
        });

        it('GIVEN curated ids THEN they are unique and non-numeric (no aggregate-id collision)', () => {
            const numeric = curated.filter((q) => /^\d+$/.test(q.id));
            expect(numeric.map((q) => q.id)).toEqual([]);
            expect(new Set(curated.map((q) => q.id)).size).toBe(curated.length);
        });

        it('GIVEN keyword queries THEN maxRank is 1', () => {
            const bad = curated.filter((q) => q.kind === 'keyword' && q.maxRank !== 1);
            expect(bad.map((q) => q.id)).toEqual([]);
        });

        it(`GIVEN each kind THEN at least ${MIN_CURATED_PER_KIND} queries are committed`, () => {
            const counts = { keyword: 0, semantic: 0 };
            for (const q of curated) counts[q.kind]++;
            expect(Math.min(counts.keyword, counts.semantic)).toBeGreaterThanOrEqual(MIN_CURATED_PER_KIND);
        });
    });
});
