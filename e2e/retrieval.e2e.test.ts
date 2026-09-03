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

interface RetrievedNote { noteId: string; title: string; score: number; }
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

function readGold(): Map<string, string[]> {
    const queries: Query[] = JSON.parse(readFileSync(join(DATASET_DIR, 'queries.json'), 'utf8'));
    return new Map(queries.map((q) => [q.id, q.relevant]));
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
        throw new Error(`e2e runner exited ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
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

function regressionMessage(m: RetrievalMetrics, baseline: Baseline): string {
    const fell = regressions(m.perQueryGoldRanks(), baseline);
    return fell.length === 0
        ? 'No gold doc dropped out of or fell in rank within the top 10 vs baseline; the aggregate drop is float noise near TOLERANCE.'
        : `Gold docs that regressed vs the pinned baseline (top 10):\n${fell.join('\n')}`;
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
        const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
        expect(m.meanNdcgAt(K), regressionMessage(m, baseline)).toBeGreaterThanOrEqual(baseline.ndcg10 - TOLERANCE);
    });

    it.skipIf(PINNING)('hybrid Recall@10 does not regress past the baseline', () => {
        const m = metricsFor(out, gold, out.defaultDenseWeight);
        const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
        expect(m.meanRecallAt(K), regressionMessage(m, baseline)).toBeGreaterThanOrEqual(baseline.recall10 - TOLERANCE);
    });
});
