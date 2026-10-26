// The result-cluster graph MODEL: turns one query's ranked results + their stored
// vectors into a deterministic graph — node positions, cluster ids, kNN edges, the
// query node at the centre. Pure and Obsidian-free (no DOM, no timers that outlive
// the call) so the renderer only paints it. Design reasons, spike measurements and
// the reference implementation: _tickets/plan-desktop-result-cluster-graph-beside-the-search-list.md.
//
// Two distances share one picture: distance from the centre = relevance (rank by
// default), proximity between notes = mutual similarity, cluster id = colour. A 2D
// layout cannot honour both exactly; it is a visual aid for spotting groups.

import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation } from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { ScoredChunk } from './types';

// ── options ─────────────────────────────────────────────────────────────────

// 'rank' mirrors the list order the user sees. 'score' min-max squashes: one
// strong #1 pushes #2–#50 onto the outer ring (seen in the spike), hence not default.
export type RadiusMode = 'rank' | 'score';

export interface ClusterGraphOptions {
    // Clusters stop merging below this percentile (0–100) of THIS query's pairwise
    // cosines. Relative, not a fixed cosine: cosines sit in a narrow ~0.62–0.94
    // band on every query, so any fixed cut links all or nothing.
    cutPercentile: number;
    // Edges = each clusterable node's `neighbours` most similar other nodes (kNN).
    neighbours: number;
    radiusMode: RadiusMode;
    // Pull of each node toward its relevance ring.
    radialStrength: number;
    // Pull along kNN edges, scaled per edge by its relative similarity.
    linkStrength: number;
}

export const DEFAULT_CUT_PERCENTILE = 85;
export const DEFAULT_NEIGHBOURS = 2;
export const DEFAULT_RADIUS_MODE: RadiusMode = 'rank';
export const DEFAULT_RADIAL_STRENGTH = 0.7;
export const DEFAULT_LINK_STRENGTH = 0.5;

export const DEFAULT_CLUSTER_GRAPH_OPTIONS: Readonly<ClusterGraphOptions> = {
    cutPercentile: DEFAULT_CUT_PERCENTILE,
    neighbours: DEFAULT_NEIGHBOURS,
    radiusMode: DEFAULT_RADIUS_MODE,
    radialStrength: DEFAULT_RADIAL_STRENGTH,
    linkStrength: DEFAULT_LINK_STRENGTH,
};

// ── input / output ──────────────────────────────────────────────────────────

export type ClusterGraphResult = Pick<ScoredChunk, 'score' | 'lexicalOnly'>;

export interface GraphSize {
    width: number;
    height: number;
}

export interface ClusterGraphInput {
    // Ranked, best first — the list order.
    results: readonly ClusterGraphResult[];
    // Aligned to `results` (SearchOrchestrator.resultVectors); null = no stored vector.
    vectors: readonly (Float32Array | null)[];
    size: GraphSize;
}

export interface GraphPoint {
    x: number;
    y: number;
}

export interface ClusterGraphNode {
    // Index into the input `results` (= the list row), so list ↔ graph can link.
    resultIndex: number;
    x: number;
    y: number;
    // 0–1, 1 = most relevant (inner ring).
    relevance: number;
    // Drawn radius in px; the layout's collision radius derives from it, so draw it as-is.
    radius: number;
    // 0 = largest cluster. null = singleton or lexical-only (no cluster).
    clusterId: number | null;
    lexicalOnly: boolean;
}

export interface ClusterGraphEdge {
    // Result indices. `source` is the node whose k-nearest list produced the edge.
    source: number;
    target: number;
    // Cosine between the two notes.
    similarity: number;
    // `similarity` min-max over this query's pairs (0–1): drives link pull and
    // lets the renderer weight stroke width/opacity.
    weight: number;
}

export interface ClusterGraphModel {
    // The query node's fixed position.
    centre: GraphPoint;
    // Ring radii for relevance 1 (inner) and 0 (outer), for drawing guide rings.
    innerRadius: number;
    outerRadius: number;
    // In rank order; results with a null vector are omitted.
    nodes: ClusterGraphNode[];
    edges: ClusterGraphEdge[];
    clusterCount: number;
}

// ── geometry / layout constants (tuned in the spike) ─────────────────────────

// Below this many clusterable vectors there is no pair to compare.
export const MIN_VECTORS_FOR_GRAPH = 2;
// Ring radius of the most relevant result, keeping it clear of the query node.
const INNER_RADIUS_PX = 50;
// Gap between the outer ring and the panel edge, leaving room for node + label.
const EDGE_MARGIN_PX = 30;
const NODE_RADIUS_MIN_PX = 4;
const NODE_RADIUS_MAX_PX = 11;
const COLLIDE_PADDING_PX = 3;
const QUERY_COLLIDE_RADIUS_PX = 10;
// Similar pairs sit closer: distance = MIN + (1 − weight) × SPAN.
const LINK_DISTANCE_MIN_PX = 25;
const LINK_DISTANCE_SPAN_PX = 60;
// Even the least similar kNN edge keeps some pull: strength = linkStrength × (FLOOR + weight).
const LINK_WEIGHT_FLOOR = 0.1;
// Light repulsion so ring-mates spread instead of stacking.
const CHARGE_STRENGTH = -25;
// = d3's default alpha decay reaching alphaMin; a fixed count keeps it deterministic.
const LAYOUT_TICKS = 300;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const UNCLUSTERED = -1;

// ── entry point ─────────────────────────────────────────────────────────────

export function buildClusterGraph(input: ClusterGraphInput, options: Partial<ClusterGraphOptions> = {}): ClusterGraphModel {
    const opts: ClusterGraphOptions = { ...DEFAULT_CLUSTER_GRAPH_OPTIONS, ...options };
    const rings = ringGeometry(input.size);
    const included = includedResults(input);
    const clusterable = included.filter(r => !r.lexicalOnly);
    if (clusterable.length < MIN_VECTORS_FOR_GRAPH) return { ...rings, nodes: [], edges: [], clusterCount: 0 };

    const sim = cosineMatrix(clusterable.map(r => r.unit));
    const sortedPairs = sortedPairwise(sim);
    const labels = averageLinkage(sim, percentileOf(sortedPairs, opts.cutPercentile));
    const clusterOf = new Map(clusterable.map((r, i) => [r.resultIndex, labels.ids[i]]));
    const edges = knnEdges(sim, opts.neighbours, sortedPairs).map(e => ({
        ...e, source: clusterable[e.source].resultIndex, target: clusterable[e.target].resultIndex,
    }));

    const relevance = relevanceOf(included, opts.radiusMode);
    const nodes: ClusterGraphNode[] = included.map((r, i) => {
        const label = clusterOf.get(r.resultIndex) ?? UNCLUSTERED;
        return {
            resultIndex: r.resultIndex, x: 0, y: 0,
            relevance: relevance[i],
            radius: NODE_RADIUS_MIN_PX + relevance[i] * (NODE_RADIUS_MAX_PX - NODE_RADIUS_MIN_PX),
            clusterId: label === UNCLUSTERED ? null : label,
            lexicalOnly: r.lexicalOnly,
        };
    });
    layout(nodes, edges, rings, opts);
    return { ...rings, nodes, edges, clusterCount: labels.count };
}

// ── steps ───────────────────────────────────────────────────────────────────

interface IncludedResult {
    resultIndex: number;
    score: number;
    lexicalOnly: boolean;
    unit: Float64Array;
}

// Results with a stored vector, in rank order, vectors unit-normalized
// (dequantized int8 is not exactly unit length, and cosine = dot only for units).
function includedResults(input: ClusterGraphInput): IncludedResult[] {
    const out: IncludedResult[] = [];
    input.results.forEach((r, resultIndex) => {
        const vec = input.vectors[resultIndex];
        if (!vec) return;
        out.push({ resultIndex, score: r.score, lexicalOnly: r.lexicalOnly === true, unit: toUnit(vec) });
    });
    return out;
}

function toUnit(vec: Float32Array): Float64Array {
    let sq = 0;
    for (const x of vec) sq += x * x;
    // A zero vector stays zero (cosine 0 to everything) rather than NaN.
    const norm = Math.sqrt(sq) || 1;
    return Float64Array.from(vec, x => x / norm);
}

interface RingGeometry {
    centre: GraphPoint;
    innerRadius: number;
    outerRadius: number;
}

function ringGeometry(size: GraphSize): RingGeometry {
    const outer = Math.min(size.width, size.height) / 2 - EDGE_MARGIN_PX;
    return {
        centre: { x: size.width / 2, y: size.height / 2 },
        innerRadius: INNER_RADIUS_PX,
        // A panel too small for the margin collapses to one ring instead of inverting.
        outerRadius: Math.max(INNER_RADIUS_PX, outer),
    };
}

function ringRadius(rings: RingGeometry, relevance: number): number {
    return rings.innerRadius + (1 - relevance) * (rings.outerRadius - rings.innerRadius);
}

// 1 = most relevant. Over INCLUDED nodes, so the rings always span inner → outer.
function relevanceOf(included: readonly IncludedResult[], mode: RadiusMode): number[] {
    const last = included.length - 1;
    if (mode === 'rank') return included.map((_, i) => (last === 0 ? 1 : 1 - i / last));
    const scores = included.map(r => r.score);
    const lo = Math.min(...scores);
    const span = Math.max(...scores) - lo;
    return scores.map(s => (span === 0 ? 1 : (s - lo) / span));
}

// Square n×n cosine matrix, row-major (vectors pre-normalized → cosine = dot).
interface SimilarityMatrix {
    n: number;
    values: Float64Array;
}

function cosineMatrix(units: readonly Float64Array[]): SimilarityMatrix {
    const n = units.length;
    const values = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        values[i * n + i] = 1;
        const a = units[i];
        for (let j = i + 1; j < n; j++) {
            const b = units[j];
            let dot = 0;
            for (let d = 0; d < a.length; d++) dot += a[d] * b[d];
            values[i * n + j] = dot;
            values[j * n + i] = dot;
        }
    }
    return { n, values };
}

function sortedPairwise(sim: SimilarityMatrix): number[] {
    const out: number[] = [];
    for (let i = 0; i < sim.n; i++) for (let j = i + 1; j < sim.n; j++) out.push(sim.values[i * sim.n + j]);
    return out.sort((a, b) => a - b);
}

// Nearest-rank percentile of an ascending list; `p` clamped to 0–100.
function percentileOf(sortedAsc: readonly number[], p: number): number {
    const clamped = Math.min(100, Math.max(0, p));
    return sortedAsc[Math.floor((clamped / 100) * (sortedAsc.length - 1))];
}

interface ClusterLabels {
    // Per matrix row: cluster id (0 = largest), or UNCLUSTERED for a singleton.
    ids: Int32Array;
    count: number;
}

// Average-linkage agglomerative clustering: repeatedly merge the pair of clusters
// with the highest mean pairwise cosine, stopping once that best mean is below `cut`.
// CEILING: naive O(n³) — every round recomputes all cluster-pair means. Fine at the
// modal's n = 50 (~0.2 ms measured); noticeable around n ≈ 300. Upgrade path: the
// Lance–Williams update on a cluster-distance matrix (O(n²) per merge).
function averageLinkage(sim: SimilarityMatrix, cut: number): ClusterLabels {
    const { n, values } = sim;
    const clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);
    while (clusters.length > 1) {
        let best = -Infinity;
        let bestA = -1;
        let bestB = -1;
        for (let a = 0; a < clusters.length; a++) {
            for (let b = a + 1; b < clusters.length; b++) {
                let sum = 0;
                for (const i of clusters[a]) for (const j of clusters[b]) sum += values[i * n + j];
                const mean = sum / (clusters[a].length * clusters[b].length);
                if (mean > best) { best = mean; bestA = a; bestB = b; }
            }
        }
        if (best < cut) break;
        clusters[bestA] = clusters[bestA].concat(clusters[bestB]);
        clusters.splice(bestB, 1);
    }
    const ids = new Int32Array(n).fill(UNCLUSTERED);
    // Stable sort: equal-size clusters keep merge order, so ids stay deterministic.
    const real = clusters.filter(c => c.length > 1).sort((a, b) => b.length - a.length);
    real.forEach((members, id) => { for (const i of members) ids[i] = id; });
    return { ids, count: real.length };
}

// Each row's `k` most similar other rows, deduped into undirected edges (first
// row to claim a pair is its source). Indices are matrix rows; the caller maps them.
function knnEdges(sim: SimilarityMatrix, k: number, sortedPairs: readonly number[]): ClusterGraphEdge[] {
    const { n, values } = sim;
    const perNode = Math.min(n - 1, Math.max(0, Math.floor(k)));
    const lo = sortedPairs[0];
    const span = sortedPairs[sortedPairs.length - 1] - lo;
    const seen = new Set<number>();
    const edges: ClusterGraphEdge[] = [];
    for (let i = 0; i < n; i++) {
        const others = Array.from({ length: n }, (_, j) => j).filter(j => j !== i);
        // Stable sort: ties keep the lower (better-ranked) index first.
        others.sort((a, b) => values[i * n + b] - values[i * n + a]);
        for (const j of others.slice(0, perNode)) {
            const pairKey = Math.min(i, j) * n + Math.max(i, j);
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);
            const similarity = values[i * n + j];
            edges.push({ source: i, target: j, similarity, weight: span === 0 ? 0 : (similarity - lo) / span });
        }
    }
    return edges;
}

// ── layout ──────────────────────────────────────────────────────────────────

interface LayoutNode extends SimulationNodeDatum {
    ringRadius: number;
    collideRadius: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
    weight: number;
}

// Seeded radial force layout, run to completion synchronously (fixed ticks, no
// animation) so the same input always yields the same positions. Writes x/y into
// `nodes`. d3-force's own randomness (jiggle) is a fixed-seed LCG per simulation,
// so it is deterministic too.
function layout(nodes: ClusterGraphNode[], edges: readonly ClusterGraphEdge[], rings: RingGeometry, opts: ClusterGraphOptions): void {
    const { centre } = rings;
    const queryNode: LayoutNode = { ringRadius: 0, collideRadius: QUERY_COLLIDE_RADIUS_PX, fx: centre.x, fy: centre.y };
    // Seed each node ON its target ring, spread by the golden angle. WHY-NOT d3's
    // default seed: a spiral around (0,0) that, with the centre at (w/2,h/2), parks
    // every node in the sector facing the top-left corner.
    const resultNodes: LayoutNode[] = nodes.map((node, i) => {
        const ring = ringRadius(rings, node.relevance);
        const angle = i * GOLDEN_ANGLE;
        return {
            ringRadius: ring,
            collideRadius: node.radius + COLLIDE_PADDING_PX,
            x: centre.x + ring * Math.cos(angle),
            y: centre.y + ring * Math.sin(angle),
        };
    });
    // Layout index = 1 + position in `nodes` (index 0 is the query node).
    const layoutIndexOf = new Map(nodes.map((node, i) => [node.resultIndex, i + 1]));
    const links: LayoutLink[] = edges.map(e => ({
        source: layoutIndexOf.get(e.source)!, target: layoutIndexOf.get(e.target)!, weight: e.weight,
    }));

    // forceSimulation always arms a d3-timer on creation; stop() before any tick
    // makes it inert (its one pending wake finds no work), so nothing animates.
    const simulation = forceSimulation<LayoutNode>([queryNode, ...resultNodes])
        .force('radial', forceRadial<LayoutNode>(d => d.ringRadius, centre.x, centre.y).strength(opts.radialStrength))
        .force('link', forceLink<LayoutNode, LayoutLink>(links)
            .distance(l => LINK_DISTANCE_MIN_PX + (1 - l.weight) * LINK_DISTANCE_SPAN_PX)
            .strength(l => opts.linkStrength * (LINK_WEIGHT_FLOOR + l.weight)))
        .force('collide', forceCollide<LayoutNode>(d => d.collideRadius))
        .force('charge', forceManyBody<LayoutNode>().strength(CHARGE_STRENGTH))
        .stop();
    simulation.tick(LAYOUT_TICKS);

    resultNodes.forEach((ln, i) => { nodes[i].x = ln.x!; nodes[i].y = ln.y!; });
}
