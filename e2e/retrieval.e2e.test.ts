// Retrieval-quality e2e gate (plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e, ticket
// nid_tthbuk08rra4lyenl50t6de1c_e — part 2 of 3).
//
//   npm run test:e2e            # E2E=1 vitest run e2e/retrieval.e2e.test.ts
//   E2E_CHANNELS=1 npm run test:e2e     # also report dense-only + bm25-only
//   E2E_PIN_BASELINE=1 npm run test:e2e # (re)write baseline.json instead of asserting
//
// Gated on E2E=1 (like the bench tests on BENCH=1) so plain `npm run test` never
// launches Chromium. It spawns e2e/harness/run.mjs ONCE (beforeAll), which indexes
// the frozen CQADupstack-android subset through the REAL production stack in a
// real Chromium page and returns each query's ranked doc ids per denseWeight
// channel. This file scores them against the qrels and gates the SHIPPED hybrid
// channel against a pinned baseline. Docs: docs/e2e-retrieval.md.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RetrievalMetrics, type GoldRanks } from './metrics';

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(E2E_DIR, '..');
const DATASET_DIR = join(E2E_DIR, 'datasets', 'cqadupstack-android');
const BASELINE_PATH = join(DATASET_DIR, 'baseline.json');
const RUNNER = 'e2e/harness/run.mjs';

const K = 10;
// The aggregate gate's slack. WHY 0.02: with 30 queries, one query's single gold
// doc falling out of the top 10 moves nDCG@10 by ~1/30 ≈ 0.033 — larger than
// this tolerance. So the gate is effectively "no query may regress unless another
// improves"; the 0.02 exists ONLY to absorb cross-machine floating-point noise in
// near-tie scores, NOT a genuine ranking change. If a cross-machine run ever
// flips a rank, open a ticket — do NOT raise TOLERANCE silently.
const TOLERANCE = 0.02;

// First cold run downloads the ~100 MB model into .bench-cache; warm runs are ~1 min.
const RUNNER_TIMEOUT_MS = 10 * 60 * 1000;
const PINNING = process.env.E2E_PIN_BASELINE === '1';

interface RetrievedNote { noteId: string; title: string; score: number; signals: RankingSignals; }
interface RankingSignals { dense: number; bm25: number; hybrid: number; }
interface RunnerOutput {
    device: string;
    defaultDenseWeight: number;
    denseWeights: number[];
    docs: number;
    queryCount: number;
    index: { chunksIndexed: number };
    perWeight: Record<string, Record<string, RetrievedNote[]>>;
    timings: { indexMs: number; firstQueryMs: number | null; queriesMs: Record<string, number> };
}

interface Baseline {
    pinnedAt: string;
    commit: string;
    device: string;
    chunks: number;
    ndcg10: number;
    recall10: number;
    mrr10: number;
    perQueryGoldRank: Record<string, GoldRanks>;
}

interface Query { id: string; text: string; relevant: string[] }

// Hand-curated must-pass queries (curated-queries.json), gated per-query below at
// the shipped hybrid denseWeight. `expectDocId` must rank within `maxRank`.
interface CuratedQuery {
    id: string;
    kind: 'keyword' | 'semantic';
    text: string;
    expectDocId: string;
    maxRank: number;
    rationale: string;
}

function readGold(): Map<string, string[]> {
    const queries: Query[] = JSON.parse(readFileSync(join(DATASET_DIR, 'queries.json'), 'utf8'));
    return new Map(queries.map((q) => [q.id, q.relevant]));
}

function readCurated(): CuratedQuery[] {
    return JSON.parse(readFileSync(join(DATASET_DIR, 'curated-queries.json'), 'utf8'));
}

// First markdown heading of a corpus note = its title, for the failure message.
function noteTitle(docId: string): string {
    const first = readFileSync(join(DATASET_DIR, 'corpus', `${docId}.md`), 'utf8').split('\n', 1)[0];
    return first.replace(/^#\s*/, '');
}

function runOnce(): RunnerOutput {
    const res = spawnSync('node', [RUNNER], {
        cwd: REPO_ROOT,
        env: process.env,
        encoding: 'utf8',
        timeout: RUNNER_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
        // status is null when spawnSync itself failed (timeout, ENOENT): res.error
        // then carries the only useful explanation.
        const why = res.error ? ` (${res.error.message})` : '';
        throw new Error(`e2e runner exited ${res.status}${why}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    }
    try {
        return JSON.parse(res.stdout) as RunnerOutput;
    } catch (e) {
        throw new Error(`e2e runner printed non-JSON: ${(e as Error).message}\n${res.stdout}`);
    }
}

// Metrics for one denseWeight channel: the runner's ranked noteId lists scored
// against the gold relevance.
function metricsFor(out: RunnerOutput, gold: Map<string, string[]>, weight: number): RetrievalMetrics {
    const channel = out.perWeight[String(weight)] ?? {};
    const ranked = new Map<string, string[]>();
    for (const [queryId, notes] of Object.entries(channel)) ranked.set(queryId, notes.map((n) => n.noteId));
    return new RetrievalMetrics(ranked, gold);
}

const round4 = (n: number): number => parseFloat(n.toFixed(4));

function printReport(out: RunnerOutput, gold: Map<string, string[]>): void {
    const rows = out.denseWeights.map((w) => {
        const m = metricsFor(out, gold, w);
        const tag = w === out.defaultDenseWeight ? ' (hybrid)' : '';
        return [
            `${w}${tag}`,
            round4(m.meanNdcgAt(K)).toFixed(4),
            round4(m.meanRecallAt(K)).toFixed(4),
            round4(m.meanMrrAt(K)).toFixed(4),
            String(m.queryCount),
        ];
    });
    const header = ['weight', `nDCG@${K}`, `Recall@${K}`, `MRR@${K}`, 'queries'];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
    const table = [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
    // eslint-disable-next-line no-console
    console.log(
        `\ne2e retrieval — device=${out.device}, ${out.docs} docs, ${out.index.chunksIndexed} chunks\n` +
        `index wall-clock ${(out.timings.indexMs / 1000).toFixed(1)} s, first-query latency ${out.timings.firstQueryMs ?? '?'} ms\n\n` +
        `${table}\n`,
    );
}

// Gold docs that regressed vs the baseline's top 10 — the regressions the gate
// exists to catch. A gold doc regresses either by falling OUT of the top 10 or by
// dropping to a WORSE (larger) rank within it; nDCG@10 drops in both cases, so
// both must be reported. Omitting the rank-drop case would let a genuine
// (near-tie reordering) regression print as "float noise" and mislead a reader
// into raising TOLERANCE — which the docs forbid. One line per (query, doc).
function regressions(current: Record<string, GoldRanks>, baseline: Baseline): string[] {
    const out: string[] = [];
    for (const [queryId, goldRanks] of Object.entries(baseline.perQueryGoldRank)) {
        for (const [docId, baseRank] of Object.entries(goldRanks)) {
            if (baseRank === null) continue; // was not retrieved at pin time either
            const nowRank = current[queryId]?.[docId] ?? null;
            if (nowRank === null) {
                out.push(`  query ${queryId} doc ${docId}: baseline rank ${baseRank} -> now absent`);
            } else if (nowRank > baseRank) {
                out.push(`  query ${queryId} doc ${docId}: baseline rank ${baseRank} -> now rank ${nowRank}`);
            }
        }
    }
    return out;
}

// The baseline is pinned on ONE device; wasm and webgpu embeddings differ in
// float rounding, so ranks in near-ties legitimately differ across devices and
// the per-query comparison would blame ranking. Refuse to gate across devices.
function readBaselineFor(device: string): Baseline {
    const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    if (baseline.device !== device) {
        throw new Error(
            `baseline.json was pinned on device=${baseline.device} but this run used E2E_DEVICE=${device}; ` +
            `the gate only compares like with like. Re-run with E2E_DEVICE=${baseline.device} (or unset).`,
        );
    }
    return baseline;
}

function regressionMessage(m: RetrievalMetrics, baseline: Baseline): string {
    const fell = regressions(m.perQueryGoldRanks(), baseline);
    return fell.length === 0
        ? 'No gold doc dropped out of or fell in rank within the top 10 vs baseline; the aggregate drop is float noise near TOLERANCE.'
        : `Gold docs that regressed vs the pinned baseline (top 10):\n${fell.join('\n')}`;
}

// Rank (1-based) of expectDocId in a curated query's ranked list, or null if it
// is absent from the top-K results.
function rankOf(ranked: RetrievedNote[], docId: string): number | null {
    const idx = ranked.findIndex((n) => n.noteId === docId);
    return idx === -1 ? null : idx + 1;
}

// Diagnosable-without-rerunning failure message: the query, the doc we expected,
// and the actual top 5 with score + dense/bm25 signals so a reader can see WHY it
// ranked where it did (e.g. a keyword miss shows bm25≈0, a semantic miss dense≈0).
function curatedFailMessage(cq: CuratedQuery, ranked: RetrievedNote[]): string {
    const top5 = ranked.slice(0, 5).map((n, i) =>
        `    #${i + 1} ${n.noteId} "${n.title}" score=${n.score.toFixed(4)} ` +
        `dense=${n.signals.dense.toFixed(4)} bm25=${n.signals.bm25.toFixed(4)}`,
    );
    const body = top5.length ? top5.join('\n') : '    (no results)';
    return (
        `[${cq.kind}] "${cq.text}"\n` +
        `  expected doc ${cq.expectDocId} "${noteTitle(cq.expectDocId)}" within rank ${cq.maxRank}\n` +
        `  actual top 5:\n${body}`
    );
}

describe.skipIf(process.env.E2E !== '1')('retrieval quality e2e', () => {
    let out: RunnerOutput;
    let gold: Map<string, string[]>;

    beforeAll(() => {
        gold = readGold();
        out = runOnce();
        printReport(out, gold);
    }, RUNNER_TIMEOUT_MS);

    // Re-pin procedure: run `E2E_PIN_BASELINE=1 npm run test:e2e` after any
    // INTENDED ranking change (dataset regeneration, or a chunker/tokenizer/BM25/
    // fusion change) — see docs/e2e-retrieval.md.
    it.runIf(PINNING)('pins baseline.json from the hybrid channel', () => {
        const m = metricsFor(out, gold, out.defaultDenseWeight);
        const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
        const baseline: Baseline = {
            pinnedAt: new Date().toISOString(),
            commit,
            device: out.device,
            chunks: out.index.chunksIndexed,
            ndcg10: round4(m.meanNdcgAt(K)),
            recall10: round4(m.meanRecallAt(K)),
            mrr10: round4(m.meanMrrAt(K)),
            perQueryGoldRank: m.perQueryGoldRanks(),
        };
        writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
        // eslint-disable-next-line no-console
        console.log(`\npinned baseline: nDCG@10=${baseline.ndcg10} Recall@10=${baseline.recall10} MRR@10=${baseline.mrr10} (${baseline.chunks} chunks, commit ${commit})\n`);
        expect(baseline.perQueryGoldRank).not.toEqual({});
    });

    it.skipIf(PINNING)('hybrid nDCG@10 does not regress past the baseline', () => {
        const m = metricsFor(out, gold, out.defaultDenseWeight);
        const baseline = readBaselineFor(out.device);
        expect(m.meanNdcgAt(K), regressionMessage(m, baseline)).toBeGreaterThanOrEqual(baseline.ndcg10 - TOLERANCE);
    });

    it.skipIf(PINNING)('hybrid Recall@10 does not regress past the baseline', () => {
        const m = metricsFor(out, gold, out.defaultDenseWeight);
        const baseline = readBaselineFor(out.device);
        expect(m.meanRecallAt(K), regressionMessage(m, baseline)).toBeGreaterThanOrEqual(baseline.recall10 - TOLERANCE);
    });

    // One assertion per hand-curated query (name = "[kind] text"), gated on the
    // shipped hybrid channel. These are absolute expectations, not baseline-relative
    // regressions, so they run whether or not we are re-pinning.
    describe('curated must-pass queries', () => {
        for (const cq of readCurated()) {
            it(`[${cq.kind}] ${cq.text}`, () => {
                const channel = out.perWeight[String(out.defaultDenseWeight)] ?? {};
                const ranked = channel[cq.id] ?? [];
                const rank = rankOf(ranked, cq.expectDocId);
                const msg = curatedFailMessage(cq, ranked);
                expect(rank, msg).not.toBeNull();
                expect(rank, msg).toBeLessThanOrEqual(cq.maxRank);
            });
        }
    });
});
