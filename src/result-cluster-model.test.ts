import { describe, it, expect } from 'vitest';
import {
    buildClusterGraph,
    CLUSTER_GRAPH_OPTION_LIMITS,
    completeClusterGraphOptions,
    DEFAULT_CLUSTER_GRAPH_OPTIONS,
    DEFAULT_LINK_STRENGTH,
    DEFAULT_NEIGHBOURS,
    DEFAULT_RADIAL_STRENGTH,
    DEFAULT_RADIUS_MODE,
    type ClusterGraphInput,
    type ClusterGraphModel,
    type ClusterGraphResult,
} from './result-cluster-model';

// Deliberately NOT 384 (the shipped model's dim): the model must not assume one.
const DIM = 16;
const SIZE = { width: 600, height: 600 };

// A vector along one axis, scaled — scaling proves the model normalizes first
// (same axis ⇒ cosine exactly 1, different axes ⇒ exactly 0).
function axisVec(axis: number, scale = 1, dim = DIM): Float32Array {
    const v = new Float32Array(dim);
    v[axis] = scale;
    return v;
}

// Deterministic, varied (non-orthogonal) vectors for edge/layout tests.
function variedVec(seed: number, dim = DIM): Float32Array {
    return Float32Array.from({ length: dim }, (_, d) => Math.sin((seed + 1) * (d + 1)) + 1);
}

// Ranked best-first: strictly descending scores.
function ranked(count: number): ClusterGraphResult[] {
    return Array.from({ length: count }, (_, i) => ({ score: 1 - i * 0.01 }));
}

// Two clearly separated groups, interleaved in rank: even ranks → axis 0 (group A),
// odd ranks → axis 1 (group B).
const GROUP_SIZE = 3;
function twoGroups(dim = DIM): ClusterGraphInput {
    const count = GROUP_SIZE * 2;
    return {
        results: ranked(count),
        vectors: Array.from({ length: count }, (_, i) => axisVec(i % 2, i + 1, dim)),
        size: SIZE,
    };
}

const VARIED_COUNT = 10;
const ALL_QUADRANTS = 4;
function varied(): ClusterGraphInput {
    return {
        results: ranked(VARIED_COUNT),
        vectors: Array.from({ length: VARIED_COUNT }, (_, i) => variedVec(i)),
        size: SIZE,
    };
}

const clusterOf = (model: ClusterGraphModel, resultIndex: number): number | null =>
    model.nodes.find(n => n.resultIndex === resultIndex)!.clusterId;
const groupClusters = (model: ClusterGraphModel, parity: number): Array<number | null> =>
    model.nodes.filter(n => n.resultIndex % 2 === parity).map(n => n.clusterId);
const distanceFromCentre = (model: ClusterGraphModel, resultIndex: number): number => {
    const n = model.nodes.find(node => node.resultIndex === resultIndex)!;
    return Math.hypot(n.x - model.centre.x, n.y - model.centre.y);
};
const edgeTouches = (model: ClusterGraphModel, resultIndex: number): boolean =>
    model.edges.some(e => e.source === resultIndex || e.target === resultIndex);

describe('GIVEN two clearly separated groups of vectors', () => {
    const model = buildClusterGraph(twoGroups());

    it('THEN every node of the first group shares one cluster', () => {
        expect(new Set(groupClusters(model, 0)).size).toBe(1);
    });

    it('THEN every node of the second group shares one cluster', () => {
        expect(new Set(groupClusters(model, 1)).size).toBe(1);
    });

    it('THEN the two groups land in different clusters', () => {
        expect(clusterOf(model, 0)).not.toBe(clusterOf(model, 1));
    });

    it('THEN neither group is left unclustered', () => {
        expect([clusterOf(model, 0), clusterOf(model, 1)]).not.toContain(null);
    });

    it('THEN the model reports two clusters', () => {
        expect(model.clusterCount).toBe(2);
    });
});

describe('GIVEN the same input', () => {
    it('WHEN the model is built twice THEN the output is identical, positions included', () => {
        expect(buildClusterGraph(varied())).toEqual(buildClusterGraph(varied()));
    });
});

describe('GIVEN varied vectors', () => {
    const k = 3;
    const model = buildClusterGraph(varied(), { neighbours: k });

    it('THEN no edge links a node to itself', () => {
        expect(model.edges.filter(e => e.source === e.target)).toEqual([]);
    });

    it('THEN no pair of nodes is linked twice', () => {
        const pairs = model.edges.map(e => `${Math.min(e.source, e.target)}-${Math.max(e.source, e.target)}`);
        expect(new Set(pairs).size).toBe(pairs.length);
    });

    it('THEN no node is the source of more than k edges', () => {
        const perSource = new Map<number, number>();
        for (const e of model.edges) perSource.set(e.source, (perSource.get(e.source) ?? 0) + 1);
        expect(Math.max(...perSource.values())).toBeLessThanOrEqual(k);
    });

    it('THEN there are edges at all', () => {
        expect(model.edges.length).toBeGreaterThan(0);
    });

    it('THEN the rank-1 node ends closer to the query centre than the last-ranked node', () => {
        expect(distanceFromCentre(model, 0)).toBeLessThan(distanceFromCentre(model, VARIED_COUNT - 1));
    });

    it('THEN every position is a finite number', () => {
        expect(model.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    });
});

describe('GIVEN varied vectors and no edges pulling nodes together', () => {
    // Isolates the seeding: links legitimately pull a connected group to one side,
    // so only without them must the radial layout use every direction.
    const model = buildClusterGraph(varied(), { neighbours: 0 });

    it('THEN the nodes spread around the centre instead of parking in one sector', () => {
        const quadrants = new Set(model.nodes.map(n => `${n.x < model.centre.x}-${n.y < model.centre.y}`));
        expect(quadrants.size).toBe(ALL_QUADRANTS);
    });
});

describe('GIVEN a lexical-only result whose title vector matches the first group', () => {
    const base = twoGroups();
    const lexicalIndex = base.results.length;
    const input: ClusterGraphInput = {
        ...base,
        results: [...base.results, { score: 0.1, lexicalOnly: true }],
        vectors: [...base.vectors, axisVec(0)],
    };
    const model = buildClusterGraph(input);

    it('THEN it is still a node', () => {
        expect(model.nodes.map(n => n.resultIndex)).toContain(lexicalIndex);
    });

    it('THEN it gets no cluster', () => {
        expect(clusterOf(model, lexicalIndex)).toBeNull();
    });

    it('THEN it gets no edges', () => {
        expect(edgeTouches(model, lexicalIndex)).toBe(false);
    });

    it('THEN it is positioned by its rank (last → outermost relevance)', () => {
        expect(model.nodes.find(n => n.resultIndex === lexicalIndex)!.relevance).toBe(0);
    });
});

describe('GIVEN a result with no stored vector', () => {
    const base = varied();
    const missingIndex = 2;
    const input: ClusterGraphInput = { ...base, vectors: base.vectors.map((v, i) => (i === missingIndex ? null : v)) };

    it('THEN it is left out of the model', () => {
        expect(buildClusterGraph(input).nodes.map(n => n.resultIndex)).not.toContain(missingIndex);
    });
});

describe('GIVEN fewer than 2 usable vectors', () => {
    it('WHEN one result has a vector and the other none THEN the model is empty', () => {
        const model = buildClusterGraph({ results: ranked(2), vectors: [axisVec(0), null], size: SIZE });
        expect(model.nodes).toEqual([]);
    });

    it('WHEN the only other vector is lexical-only THEN the model is empty', () => {
        const results = [{ score: 1 }, { score: 0.5, lexicalOnly: true }];
        const model = buildClusterGraph({ results, vectors: [axisVec(0), axisVec(1)], size: SIZE });
        expect(model.nodes).toEqual([]);
    });

    it('WHEN there are no results THEN the model is empty without throwing', () => {
        const model = buildClusterGraph({ results: [], vectors: [], size: SIZE });
        expect(model.nodes).toEqual([]);
    });
});

describe('GIVEN vectors of a different dimension', () => {
    const otherDim = 3;
    const model = buildClusterGraph(twoGroups(otherDim));

    it('THEN the two groups still land in two clusters', () => {
        expect(model.clusterCount).toBe(2);
    });
});

describe('GIVEN options', () => {
    it('WHEN options are omitted THEN the named defaults apply', () => {
        expect(buildClusterGraph(varied())).toEqual(buildClusterGraph(varied(), DEFAULT_CLUSTER_GRAPH_OPTIONS));
    });

    it('WHEN only some options are given THEN the rest fall back to the named defaults', () => {
        expect(buildClusterGraph(varied(), { neighbours: 1 }))
            .toEqual(buildClusterGraph(varied(), { ...DEFAULT_CLUSTER_GRAPH_OPTIONS, neighbours: 1 }));
    });

    it('WHEN the cut percentile drops to 0 THEN both groups merge into one cluster', () => {
        expect(buildClusterGraph(twoGroups(), { cutPercentile: 0 }).clusterCount).toBe(1);
    });

    it('WHEN k changes THEN the edges change', () => {
        expect(buildClusterGraph(varied(), { neighbours: 1 }).edges)
            .not.toEqual(buildClusterGraph(varied(), { neighbours: 3 }).edges);
    });

    it('WHEN the radius mode is score THEN relevance follows the score gaps, not the rank', () => {
        const input: ClusterGraphInput = { ...varied(), results: [{ score: 1 }, ...ranked(VARIED_COUNT - 1).map(r => ({ score: r.score / 2 }))] };
        const byScore = buildClusterGraph(input, { radiusMode: 'score' }).nodes.map(n => n.relevance);
        expect(byScore).not.toEqual(buildClusterGraph(input, { radiusMode: 'rank' }).nodes.map(n => n.relevance));
    });

    it('WHEN the radial strength changes THEN the positions change', () => {
        expect(buildClusterGraph(varied(), { radialStrength: 0.1 }).nodes)
            .not.toEqual(buildClusterGraph(varied()).nodes);
    });

    it('WHEN the link strength changes THEN the positions change', () => {
        expect(buildClusterGraph(varied(), { linkStrength: 0 }).nodes)
            .not.toEqual(buildClusterGraph(varied()).nodes);
    });
});

describe('completeClusterGraphOptions', () => {
    it('GIVEN nothing persisted THEN returns the defaults', () => {
        expect(completeClusterGraphOptions(undefined)).toEqual(DEFAULT_CLUSTER_GRAPH_OPTIONS);
    });

    it('GIVEN a partial object THEN keeps the persisted field', () => {
        expect(completeClusterGraphOptions({ cutPercentile: 70 }).cutPercentile).toBe(70);
    });

    it('GIVEN a partial object THEN fills every missing field with its default', () => {
        const { cutPercentile: _persisted, ...rest } = completeClusterGraphOptions({ cutPercentile: 70 });
        const { cutPercentile: _default, ...defaultRest } = DEFAULT_CLUSTER_GRAPH_OPTIONS;
        expect(rest).toEqual(defaultRest);
    });

    it('GIVEN an explicit undefined THEN uses the default (spread would have kept undefined)', () => {
        expect(completeClusterGraphOptions({ neighbours: undefined }).neighbours).toBe(DEFAULT_NEIGHBOURS);
    });

    it('GIVEN a non-numeric value THEN uses the default', () => {
        expect(completeClusterGraphOptions({ linkStrength: '0.3' }).linkStrength).toBe(DEFAULT_LINK_STRENGTH);
    });

    it('GIVEN NaN THEN uses the default', () => {
        expect(completeClusterGraphOptions({ radialStrength: NaN }).radialStrength).toBe(DEFAULT_RADIAL_STRENGTH);
    });

    it('GIVEN a value above its range THEN clamps to the max', () => {
        expect(completeClusterGraphOptions({ neighbours: 99 }).neighbours).toBe(CLUSTER_GRAPH_OPTION_LIMITS.neighbours.max);
    });

    it('GIVEN a value below its range THEN clamps to the min', () => {
        expect(completeClusterGraphOptions({ cutPercentile: 10 }).cutPercentile).toBe(CLUSTER_GRAPH_OPTION_LIMITS.cutPercentile.min);
    });

    it('GIVEN a fractional value for an integer option THEN rounds it', () => {
        expect(completeClusterGraphOptions({ neighbours: 2.6 }).neighbours).toBe(3);
    });

    it('GIVEN an unknown radius mode THEN uses the default', () => {
        expect(completeClusterGraphOptions({ radiusMode: 'distance' }).radiusMode).toBe(DEFAULT_RADIUS_MODE);
    });

    it('GIVEN a valid radius mode THEN keeps it', () => {
        expect(completeClusterGraphOptions({ radiusMode: 'score' }).radiusMode).toBe('score');
    });

    it('THEN every default sits inside its own range', () => {
        expect(completeClusterGraphOptions({ ...DEFAULT_CLUSTER_GRAPH_OPTIONS })).toEqual(DEFAULT_CLUSTER_GRAPH_OPTIONS);
    });
});
