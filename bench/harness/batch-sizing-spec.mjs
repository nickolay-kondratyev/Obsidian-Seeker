// The `budget/max` text form of a BatchSizing (src/batch-sizing.ts), shared by
// the harness env var BENCH_BATCH_SIZING (run.mjs) and the sizing sweep
// (scripts/bench-sweep.mjs, BENCH_CANDIDATES). "2048/16" is NOT a ratio: it is
// budgetTokens=2048 (target batch × seq tokens per dispatch, the stall cap)
// and maxBatch=16 (ceiling on chunks per dispatch).
export class BatchSizingSpec {
    static SYNTAX = 'budget/max, e.g. 2048/16';

    /** @returns {{ budgetTokens: number, maxBatch: number }} */
    static parse(text) {
        const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text ?? '');
        if (!m) throw new Error(`batch sizing [${text}] is not of the form ${BatchSizingSpec.SYNTAX}`);
        const sizing = { budgetTokens: Number(m[1]), maxBatch: Number(m[2]) };
        if (sizing.budgetTokens <= 0 || sizing.maxBatch <= 0) throw new Error(`batch sizing [${text}] must have a positive budget and max`);
        return sizing;
    }

    /** Comma-separated list → sizings, in order, duplicates rejected. */
    static parseList(text) {
        const specs = text.split(',').map(s => s.trim()).filter(Boolean);
        const seen = new Set();
        return specs.map(spec => {
            const sizing = BatchSizingSpec.parse(spec);
            const key = BatchSizingSpec.format(sizing);
            if (seen.has(key)) throw new Error(`batch sizing [${key}] is listed twice`);
            seen.add(key);
            return sizing;
        });
    }

    static format(sizing) { return `${sizing.budgetTokens}/${sizing.maxBatch}`; }
}
