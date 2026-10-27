// Pure logic of the result map panel: when it shows, the after-paint + stale-drop
// loader, and the label/colour/selection helpers. The DOM panel itself has no
// jsdom here (see vitest.config.mts); the real-Obsidian e2e covers rendering.

import { describe, it, expect } from 'vitest';
import {
    CLUSTER_PALETTE_SIZE,
    MAP_MODAL_VIEWPORT_SHARE,
    MIN_DEFAULT_MAP_WIDTH_PX,
    MIN_WINDOW_WIDTH_FOR_MAP_PX,
    ResultMapLoader,
    edgeTouches,
    labelPlacement,
    nodeColourClass,
    resultMapAvailable,
    resultMapFits,
    truncateLabel,
    type ResultMapLoaderDeps,
} from './result-map-panel';
import { DEFAULT_CLUSTER_GRAPH_OPTIONS, type ClusterGraphOptions } from './result-cluster-model';
import { DEFAULT_LIST_WIDTH_PX } from './result-map-divider';
import type { ScoredChunk } from './types';

const DIM = 8;
const SIZE = { width: 400, height: 400 };
const ENOUGH_RESULTS = 10;

function vec(seed: number): Float32Array {
    return Float32Array.from({ length: DIM }, (_, d) => Math.sin((seed + 1) * (d + 1)) + 1);
}

// Only the fields the cluster model reads.
function results(count: number): ScoredChunk[] {
    return Array.from({ length: count }, (_, i) => ({ score: 1 - i * 0.01, chunk_id: `c${i}` }) as unknown as ScoredChunk);
}

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(e: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

// A loader whose paint and vector fetches resolve only when the test says so.
class ControlledDeps implements ResultMapLoaderDeps {
    readonly paints: Deferred<void>[] = [];
    readonly fetches: Deferred<Array<Float32Array | null>>[] = [];
    readonly fetchedCounts: number[] = [];

    afterPaint(): Promise<void> {
        const d = deferred<void>();
        this.paints.push(d);
        return d.promise;
    }

    fetchVectors(rs: readonly ScoredChunk[]): Promise<Array<Float32Array | null>> {
        this.fetchedCounts.push(rs.length);
        const d = deferred<Array<Float32Array | null>>();
        this.fetches.push(d);
        return d.promise;
    }

    // The drawing area; tests replace it to simulate a resize.
    size = SIZE;

    measure() {
        return this.size;
    }

    // The live tuning; tests replace it to simulate a control moving.
    tuning: ClusterGraphOptions = { ...DEFAULT_CLUSTER_GRAPH_OPTIONS };

    options(): ClusterGraphOptions {
        return this.tuning;
    }
}

const vectorsFor = (count: number): Float32Array[] => Array.from({ length: count }, (_, i) => vec(i));
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('resultMapAvailable', () => {
    it('is true on desktop with the setting on', () => {
        expect(resultMapAvailable({ isMobile: false, showResultMap: true })).toBe(true);
    });

    it('is false on mobile even with the setting on', () => {
        expect(resultMapAvailable({ isMobile: true, showResultMap: true })).toBe(false);
    });

    it('is false on desktop with the setting off', () => {
        expect(resultMapAvailable({ isMobile: false, showResultMap: false })).toBe(false);
    });
});

describe('resultMapFits', () => {
    it('fits at exactly the minimum window width', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX, resultCount: ENOUGH_RESULTS })).toBe(true);
    });

    it('does not fit in a window narrower than the minimum', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX - 1, resultCount: ENOUGH_RESULTS })).toBe(false);
    });

    it('does not fit a single result (nothing to compare it with)', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX, resultCount: 1 })).toBe(false);
    });

    it('does not fit zero results', () => {
        expect(resultMapFits({ windowWidth: MIN_WINDOW_WIDTH_FOR_MAP_PX, resultCount: 0 })).toBe(false);
    });

    it('at the minimum window width the map-showing modal still holds the default list and map', () => {
        const modalWidth = MIN_WINDOW_WIDTH_FOR_MAP_PX * MAP_MODAL_VIEWPORT_SHARE;
        expect(modalWidth).toBeGreaterThanOrEqual(DEFAULT_LIST_WIDTH_PX + MIN_DEFAULT_MAP_WIDTH_PX);
    });
});

describe('ResultMapLoader', () => {
    it('does not fetch vectors before the list frame has painted', async () => {
        const deps = new ControlledDeps();
        void new ResultMapLoader(deps).load(results(ENOUGH_RESULTS));
        await flush();
        expect(deps.fetchedCounts).toEqual([]);
    });

    it('fetches vectors for every result once the frame has painted', async () => {
        const deps = new ControlledDeps();
        void new ResultMapLoader(deps).load(results(ENOUGH_RESULTS));
        deps.paints[0].resolve();
        await flush();
        expect(deps.fetchedCounts).toEqual([ENOUGH_RESULTS]);
    });

    it('builds a model with one node per result that has a vector', async () => {
        const deps = new ControlledDeps();
        const loading = new ResultMapLoader(deps).load(results(ENOUGH_RESULTS));
        deps.paints[0].resolve();
        await flush();
        deps.fetches[0].resolve([...vectorsFor(ENOUGH_RESULTS - 1), null]);
        expect((await loading)?.nodes.length).toBe(ENOUGH_RESULTS - 1);
    });

    describe('GIVEN an older load still waiting on its vectors when a newer load starts', () => {
        async function raceTwoLoads() {
            const deps = new ControlledDeps();
            const loader = new ResultMapLoader(deps);
            const older = loader.load(results(ENOUGH_RESULTS));
            deps.paints[0].resolve();
            await flush();
            const newer = loader.load(results(ENOUGH_RESULTS));
            deps.paints[1].resolve();
            await flush();
            // The newer query's vectors land first, the older one's last.
            deps.fetches[1].resolve(vectorsFor(ENOUGH_RESULTS));
            deps.fetches[0].resolve(vectorsFor(ENOUGH_RESULTS));
            return { older: await older, newer: await newer };
        }

        it('drops the older load', async () => {
            expect((await raceTwoLoads()).older).toBeNull();
        });

        it('still builds the newer load', async () => {
            expect((await raceTwoLoads()).newer?.nodes.length).toBe(ENOUGH_RESULTS);
        });
    });

    it('never fetches vectors for a load superseded before its frame painted', async () => {
        const deps = new ControlledDeps();
        const loader = new ResultMapLoader(deps);
        void loader.load(results(ENOUGH_RESULTS));
        void loader.load(results(ENOUGH_RESULTS));
        deps.paints[0].resolve();
        await flush();
        expect(deps.fetchedCounts).toEqual([]);
    });

    it('resolves null after cancel (the modal left the results state)', async () => {
        const deps = new ControlledDeps();
        const loader = new ResultMapLoader(deps);
        const loading = loader.load(results(ENOUGH_RESULTS));
        deps.paints[0].resolve();
        await flush();
        loader.cancel();
        deps.fetches[0].resolve(vectorsFor(ENOUGH_RESULTS));
        expect(await loading).toBeNull();
    });

    it('rethrows a vector-fetch failure of the current load', async () => {
        const deps = new ControlledDeps();
        const loading = new ResultMapLoader(deps).load(results(ENOUGH_RESULTS));
        deps.paints[0].resolve();
        await flush();
        deps.fetches[0].reject(new Error('idb closed'));
        await expect(loading).rejects.toThrow('idb closed');
    });

    it('swallows a vector-fetch failure of a superseded load', async () => {
        const deps = new ControlledDeps();
        const loader = new ResultMapLoader(deps);
        const older = loader.load(results(ENOUGH_RESULTS));
        deps.paints[0].resolve();
        await flush();
        loader.cancel();
        deps.fetches[0].reject(new Error('idb closed'));
        expect(await older).toBeNull();
    });
});

describe('ResultMapLoader relayout', () => {
    const NO_EDGES: Partial<ClusterGraphOptions> = { neighbours: 0 };

    async function completedLoad() {
        const deps = new ControlledDeps();
        const loader = new ResultMapLoader(deps);
        const loading = loader.load(results(ENOUGH_RESULTS));
        deps.paints[0].resolve();
        await flush();
        deps.fetches[0].resolve(vectorsFor(ENOUGH_RESULTS));
        const first = await loading;
        return { deps, loader, first };
    }

    describe('GIVEN a completed load', () => {
        it('THEN the first build has edges (so the no-edge tuning below is a real change)', async () => {
            const { first } = await completedLoad();
            expect(first?.edges.length).toBeGreaterThan(0);
        });

        it('WHEN the tuning changes THEN relayout does not fetch vectors again', async () => {
            const { deps, loader } = await completedLoad();
            deps.tuning = { ...deps.tuning, ...NO_EDGES };
            loader.relayout();
            expect(deps.fetchedCounts).toEqual([ENOUGH_RESULTS]);
        });

        it('WHEN the tuning changes THEN relayout applies it', async () => {
            const { deps, loader } = await completedLoad();
            deps.tuning = { ...deps.tuning, ...NO_EDGES };
            expect(loader.relayout()?.edges.length).toBe(0);
        });

        it('WHEN the tuning changes THEN relayout keeps every node', async () => {
            const { deps, loader } = await completedLoad();
            deps.tuning = { ...deps.tuning, ...NO_EDGES };
            expect(loader.relayout()?.nodes.length).toBe(ENOUGH_RESULTS);
        });

        it('WHEN the drawing area resized THEN relayout lays out for the new size', async () => {
            const { deps, loader } = await completedLoad();
            deps.size = { width: SIZE.width * 2, height: SIZE.height };
            expect(loader.relayout()?.centre.x).toBe(SIZE.width);
        });

        it('WHEN the drawing area resized THEN relayout does not fetch vectors again', async () => {
            const { deps, loader } = await completedLoad();
            deps.size = { width: SIZE.width * 2, height: SIZE.height };
            loader.relayout();
            expect(deps.fetchedCounts).toEqual([ENOUGH_RESULTS]);
        });

        it('WHEN a newer load is in flight THEN relayout returns null (that load reads the tuning itself)', async () => {
            const { loader } = await completedLoad();
            void loader.load(results(ENOUGH_RESULTS));
            expect(loader.relayout()).toBeNull();
        });

        it('WHEN cancelled THEN relayout returns null', async () => {
            const { loader } = await completedLoad();
            loader.cancel();
            expect(loader.relayout()).toBeNull();
        });
    });

    it('returns null before any load completed', () => {
        expect(new ResultMapLoader(new ControlledDeps()).relayout()).toBeNull();
    });

    it('a load builds with the tuning live at build time', async () => {
        const deps = new ControlledDeps();
        const loading = new ResultMapLoader(deps).load(results(ENOUGH_RESULTS));
        deps.tuning = { ...deps.tuning, ...NO_EDGES };
        deps.paints[0].resolve();
        await flush();
        deps.fetches[0].resolve(vectorsFor(ENOUGH_RESULTS));
        expect((await loading)?.edges.length).toBe(0);
    });
});

describe('truncateLabel', () => {
    it('keeps a short title as-is', () => {
        expect(truncateLabel('Android build')).toBe('Android build');
    });

    it('ends a long title with an ellipsis', () => {
        expect(truncateLabel('x'.repeat(100)).endsWith('…')).toBe(true);
    });
});

describe('labelPlacement', () => {
    const PANEL_WIDTH = 400;
    const NODE_RADIUS = 6;
    const TEXT_WIDTH = 100;

    it('places the label right of a node with room to its right', () => {
        expect(labelPlacement(50, NODE_RADIUS, TEXT_WIDTH, PANEL_WIDTH).anchor).toBe('start');
    });

    it('flips the label to the left when it would clip at the right edge', () => {
        expect(labelPlacement(350, NODE_RADIUS, TEXT_WIDTH, PANEL_WIDTH).anchor).toBe('end');
    });

    it('puts a flipped label left of the node', () => {
        expect(labelPlacement(350, NODE_RADIUS, TEXT_WIDTH, PANEL_WIDTH).x).toBeLessThan(350 - NODE_RADIUS);
    });
});

describe('nodeColourClass', () => {
    it('greys out a title-only match even if it carried a cluster id', () => {
        expect(nodeColourClass({ clusterId: 0, lexicalOnly: true })).toBe('is-lexical');
    });

    it('greys out a note in no cluster', () => {
        expect(nodeColourClass({ clusterId: null, lexicalOnly: false })).toBe('is-unclustered');
    });

    it('wraps cluster ids past the palette size', () => {
        expect(nodeColourClass({ clusterId: CLUSTER_PALETTE_SIZE + 1, lexicalOnly: false })).toBe('seeker-map-c1');
    });
});

describe('edgeTouches (selection highlight)', () => {
    const edge = { source: 2, target: 5 };

    it('lights an edge from the selected node', () => {
        expect(edgeTouches(edge, 2)).toBe(true);
    });

    it('lights an edge to the selected node', () => {
        expect(edgeTouches(edge, 5)).toBe(true);
    });

    it('leaves an edge between two other nodes dark', () => {
        expect(edgeTouches(edge, 3)).toBe(false);
    });
});
