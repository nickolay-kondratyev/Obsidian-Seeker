import { describe, it, expect } from 'vitest';
import { CpuGate, CpuSample, RunStats, CPU_BUSY_THRESHOLD } from './bench-math.mjs';

describe('CpuGate.busyFraction', () => {
    it('GIVEN 3 of 10 ticks non-idle THEN reports 0.3', () => {
        expect(CpuGate.busyFraction(new CpuSample(100, 200), new CpuSample(107, 210))).toBeCloseTo(0.3);
    });
    it('GIVEN no elapsed ticks THEN reports idle (0)', () => {
        expect(CpuGate.busyFraction(new CpuSample(5, 5), new CpuSample(5, 5))).toBe(0);
    });
    it('GIVEN all ticks idle THEN reports 0', () => {
        expect(CpuGate.busyFraction(new CpuSample(0, 0), new CpuSample(50, 50))).toBe(0);
    });
});

describe('CpuGate.isTooBusy', () => {
    it('GIVEN busy exactly at the threshold THEN it is NOT too busy', () => {
        expect(CpuGate.isTooBusy(CPU_BUSY_THRESHOLD)).toBe(false);
    });
    it('GIVEN busy just above the threshold THEN it is too busy', () => {
        expect(CpuGate.isTooBusy(CPU_BUSY_THRESHOLD + 0.001)).toBe(true);
    });
});

describe('CpuSample.fromProcStat', () => {
    // user nice system idle iowait irq softirq steal
    const stat = 'cpu  10 1 4 80 5 0 0 0\ncpu0 10 1 4 80 5 0 0 0\n';
    it('sums idle + iowait as idle', () => {
        expect(CpuSample.fromProcStat(stat).idle).toBe(85);
    });
    it('sums every column as total', () => {
        expect(CpuSample.fromProcStat(stat).total).toBe(100);
    });
});

describe('CpuSample.fromOsCpus', () => {
    const cpus = [
        { times: { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 } },
        { times: { user: 20, nice: 0, sys: 0, idle: 80, irq: 0 } },
    ];
    it('sums idle across cores', () => {
        expect(CpuSample.fromOsCpus(cpus).idle).toBe(165);
    });
    it('sums all times across cores as total', () => {
        expect(CpuSample.fromOsCpus(cpus).total).toBe(200);
    });
});

describe('RunStats.median', () => {
    it('GIVEN odd count THEN the middle value', () => {
        expect(RunStats.median([30, 10, 20])).toBe(20);
    });
    it('GIVEN even count THEN the mean of the two middle values', () => {
        expect(RunStats.median([40, 10, 30, 20])).toBe(25);
    });
    it('GIVEN empty list THEN throws', () => {
        expect(() => RunStats.median([])).toThrow();
    });
});

describe('RunStats.spread', () => {
    it('reports (max - min) / median in percent', () => {
        expect(RunStats.spread([90, 100, 110]).spreadPct).toBeCloseTo(20);
    });
    it('GIVEN median 0 THEN spread is 0 rather than NaN', () => {
        expect(RunStats.spread([0, 0, 0]).spreadPct).toBe(0);
    });
});

describe('RunStats.summarize', () => {
    const runs = [
        { wallClockMs: 1000, chunksPerSec: 4, warmupMs: null },
        { wallClockMs: 1100, chunksPerSec: 3.5, warmupMs: null },
        { wallClockMs: 900, chunksPerSec: 4.5, warmupMs: null },
    ];
    it('reduces a numeric metric to its median', () => {
        expect(RunStats.summarize(runs).wallClockMs.median).toBe(1000);
    });
    it('skips a metric that is null in the runs (warmupMs on wasm)', () => {
        expect(RunStats.summarize(runs)).not.toHaveProperty('warmupMs');
    });
    it('skips a metric that is absent from the harness output', () => {
        expect(RunStats.summarize(runs)).not.toHaveProperty('paceWaitMs');
    });
});
