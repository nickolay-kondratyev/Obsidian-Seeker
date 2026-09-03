// Pure math for scripts/bench.mjs: the CPU-idle gate and the reps reducer.
// Kept dependency-free and side-effect-free so scripts/bench-math.test.mjs
// can pin the arithmetic without spawning Chromium.

// ── CPU-idle gate ───────────────────────────────────────────────────────────
// A bench run on a busy machine is noise. We sample CPU time twice, CPU_GATE_WINDOW_MS
// apart, and refuse to run when the busy fraction exceeds CPU_BUSY_THRESHOLD.
export const CPU_GATE_WINDOW_MS = 2000;
export const CPU_BUSY_THRESHOLD = 0.20;

/** One CPU-time snapshot, summed over all cores. `idle` includes iowait. Units are arbitrary but must match between snapshots. */
export class CpuSample {
    constructor(idle, total) { this.idle = idle; this.total = total; }

    /** Linux /proc/stat first line: `cpu user nice system idle iowait irq softirq steal ...`. */
    static fromProcStat(text) {
        const cpuLine = text.split('\n').find(l => /^cpu\s/.test(l));
        if (!cpuLine) throw new Error('no aggregate "cpu" line in /proc/stat');
        const t = cpuLine.trim().split(/\s+/).slice(1).map(Number);
        const [, , , idle, iowait = 0] = t;
        return new CpuSample(idle + iowait, t.reduce((a, b) => a + b, 0));
    }

    /** Portable fallback from Node's os.cpus() (times in ms per core). */
    static fromOsCpus(cpus) {
        let idle = 0, total = 0;
        for (const { times } of cpus) {
            idle += times.idle;
            total += times.user + times.nice + times.sys + times.idle + times.irq;
        }
        return new CpuSample(idle, total);
    }
}

export class CpuGate {
    /** Busy fraction in [0, 1] over the interval between two samples. A zero-length interval counts as idle. */
    static busyFraction(before, after) {
        const total = after.total - before.total;
        if (total <= 0) return 0;
        const idle = after.idle - before.idle;
        return Math.min(1, Math.max(0, 1 - idle / total));
    }

    static isTooBusy(busyFraction) {
        return busyFraction > CPU_BUSY_THRESHOLD;
    }
}

// ── reps reducer ────────────────────────────────────────────────────────────
// Metrics reported as median + min/max spread across the measured runs. The
// keys are the harness JSON's top-level numeric fields that a lever can move.
export const SUMMARY_METRICS = [
    'wallClockMs', 'embedDurationMs', 'filesPerSec', 'chunksPerSec', 'embedDispatches', 'effectiveBatch',
    'paddedTokens', 'paceWaitMs', 'paceGatedDispatches', 'paceUngatedDispatches', 'coldStartMs', 'warmupMs',
];

export class RunStats {
    static median(values) {
        if (values.length === 0) throw new Error('median of empty list');
        const s = [...values].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    /** `{ median, min, max, spreadPct }` for one metric. spreadPct = (max - min) / median, in percent; 0 when the median is 0. */
    static spread(values) {
        const median = RunStats.median(values);
        const min = Math.min(...values), max = Math.max(...values);
        const spreadPct = median === 0 ? 0 : ((max - min) / median) * 100;
        return { median, min, max, spreadPct };
    }

    /** Reduce N harness result objects into `{ metric: spread }`, skipping metrics that are null/absent in any run (e.g. warmupMs on wasm). */
    static summarize(runs, metrics = SUMMARY_METRICS) {
        const out = {};
        for (const key of metrics) {
            const values = runs.map(r => r[key]);
            if (values.some(v => typeof v !== 'number' || Number.isNaN(v))) continue;
            out[key] = RunStats.spread(values);
        }
        return out;
    }
}
