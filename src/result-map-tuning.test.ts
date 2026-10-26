// Pure helpers of the result map tuning popover. The popover DOM has no jsdom here
// (see vitest.config.mts); the real-Obsidian e2e covers it.

import { describe, it, expect } from 'vitest';
import { CLUSTER_GRAPH_OPTION_LIMITS, DEFAULT_CLUSTER_GRAPH_OPTIONS, DEFAULT_NEIGHBOURS } from './result-cluster-model';
import { CLUSTER_SLIDERS, FORCE_SLIDERS, isDefaultTuning, withOption } from './result-map-tuning';

describe('withOption', () => {
    it('sets the moved option', () => {
        expect(withOption(DEFAULT_CLUSTER_GRAPH_OPTIONS, 'neighbours', 4).neighbours).toBe(4);
    });

    it('leaves the other options untouched', () => {
        expect(withOption(DEFAULT_CLUSTER_GRAPH_OPTIONS, 'neighbours', 4).cutPercentile).toBe(DEFAULT_CLUSTER_GRAPH_OPTIONS.cutPercentile);
    });

    it('falls back to the default for a non-finite value (never NaN into the model)', () => {
        expect(withOption(DEFAULT_CLUSTER_GRAPH_OPTIONS, 'neighbours', Number('x')).neighbours).toBe(DEFAULT_NEIGHBOURS);
    });
});

describe('isDefaultTuning', () => {
    it('is true for the model defaults', () => {
        expect(isDefaultTuning({ ...DEFAULT_CLUSTER_GRAPH_OPTIONS })).toBe(true);
    });

    it('is false once any option moved', () => {
        expect(isDefaultTuning({ ...DEFAULT_CLUSTER_GRAPH_OPTIONS, radiusMode: 'score' })).toBe(false);
    });
});

describe('slider spec', () => {
    const sliders = [...CLUSTER_SLIDERS, ...FORCE_SLIDERS];

    it('has one slider per numeric option', () => {
        expect(sliders.map(s => s.key).sort()).toEqual(Object.keys(CLUSTER_GRAPH_OPTION_LIMITS).sort());
    });

    it('lands every default on a slider step (so the slider can show it exactly)', () => {
        const offStep = sliders.filter(s => {
            const steps = (DEFAULT_CLUSTER_GRAPH_OPTIONS[s.key] - CLUSTER_GRAPH_OPTION_LIMITS[s.key].min) / s.step;
            return Math.abs(steps - Math.round(steps)) > 1e-9;
        });
        expect(offStep.map(s => s.key)).toEqual([]);
    });
});
