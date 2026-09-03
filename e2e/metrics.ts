// Pure retrieval-quality metrics for the e2e suite (ticket
// nid_tthbuk08rra4lyenl50t6de1c_e). No Obsidian, no browser, no I/O — unit-tested
// in metrics.test.ts and reused by retrieval.e2e.test.ts to score the runner's
// per-query ranked doc-id lists against the qrels ground truth.
//
// Relevance is BINARY (CQADupstack qrels are all score 1): a doc is either
// relevant or not. Doc ids are opaque strings (the corpus ids); "rank" is always
// 1-based position in a query's ranked list.

// nDCG discount is 1 / log2(rank + 1) (Järvelin & Kekäläinen). Standing constant
// so the discount base lives in one place.
const DCG_LOG_BASE = 2;

function discount(rank: number): number {
    return 1 / (Math.log(rank + 1) / Math.log(DCG_LOG_BASE));
}

// A gold doc's rank within a query's ranked list, or null when it is absent from
// the (top-K) results. Keyed by doc id.
export type GoldRanks = Record<string, number | null>;

// One query's outcome: the ranked doc ids it returned and the set of relevant
// (gold) doc ids. All @k metrics read only the first k ranked ids.
export class QueryRanking {
    private readonly relevant: ReadonlySet<string>;

    constructor(private readonly ranked: readonly string[], relevant: Iterable<string>) {
        this.relevant = new Set(relevant);
    }

    // nDCG@k with binary gains: DCG over the top k divided by the ideal DCG (all
    // relevant docs packed at the top). 0 when the query has no relevant docs.
    ndcgAt(k: number): number {
        const relCount = this.relevant.size;
        if (relCount === 0) return 0;
        let dcg = 0;
        const top = this.ranked.slice(0, k);
        for (let i = 0; i < top.length; i++) {
            if (this.relevant.has(top[i])) dcg += discount(i + 1);
        }
        let idcg = 0;
        for (let i = 0; i < Math.min(k, relCount); i++) idcg += discount(i + 1);
        return dcg / idcg;
    }

    // Fraction of the query's relevant docs found in the top k.
    recallAt(k: number): number {
        const relCount = this.relevant.size;
        if (relCount === 0) return 0;
        let found = 0;
        const top = this.ranked.slice(0, k);
        for (const id of top) if (this.relevant.has(id)) found++;
        return found / relCount;
    }

    // Reciprocal rank of the FIRST relevant doc within the top k (0 if none).
    reciprocalRankAt(k: number): number {
        const top = this.ranked.slice(0, k);
        for (let i = 0; i < top.length; i++) {
            if (this.relevant.has(top[i])) return 1 / (i + 1);
        }
        return 0;
    }

    // Each relevant doc's 1-based rank in the ranked list, or null if it did not
    // appear. The map that pins the baseline and drives the regression message.
    goldRanks(): GoldRanks {
        const out: GoldRanks = {};
        for (const id of this.relevant) {
            const idx = this.ranked.indexOf(id);
            out[id] = idx === -1 ? null : idx + 1;
        }
        return out;
    }
}

// Aggregate metrics over a set of queries. `ranked`/`relevant` are keyed by query
// id; a query id present in `relevant` but absent from `ranked` is treated as an
// empty ranked list (it scores 0), never silently dropped.
export class RetrievalMetrics {
    private readonly perQuery: Map<string, QueryRanking>;

    constructor(ranked: ReadonlyMap<string, readonly string[]>, relevant: ReadonlyMap<string, Iterable<string>>) {
        this.perQuery = new Map();
        for (const [queryId, rel] of relevant) {
            this.perQuery.set(queryId, new QueryRanking(ranked.get(queryId) ?? [], rel));
        }
    }

    get queryCount(): number {
        return this.perQuery.size;
    }

    private mean(score: (q: QueryRanking) => number): number {
        if (this.perQuery.size === 0) return 0;
        let sum = 0;
        for (const q of this.perQuery.values()) sum += score(q);
        return sum / this.perQuery.size;
    }

    meanNdcgAt(k: number): number {
        return this.mean((q) => q.ndcgAt(k));
    }

    meanRecallAt(k: number): number {
        return this.mean((q) => q.recallAt(k));
    }

    meanMrrAt(k: number): number {
        return this.mean((q) => q.reciprocalRankAt(k));
    }

    // queryId → { docId → rank|null } across every query. The shape pinned as
    // baseline.perQueryGoldRank and compared against on a regression.
    perQueryGoldRanks(): Record<string, GoldRanks> {
        const out: Record<string, GoldRanks> = {};
        for (const [queryId, q] of this.perQuery) out[queryId] = q.goldRanks();
        return out;
    }
}
