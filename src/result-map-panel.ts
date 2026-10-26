// The desktop result map: the search modal's cluster graph, drawn beside the
// result list (plan: _tickets/plan-desktop-result-cluster-graph-beside-the-search-list.md).
// result-cluster-model.ts computes the graph; this module decides WHEN to show it,
// fetches vectors + lays out only AFTER the list has painted, drops stale queries,
// paints the SVG and links its selection to the list's selectedIndex (node index ==
// result index == list row). The modal owns the selection; the panel only reports
// node hover/click and paints whatever index the modal selects. Tuning changes
// from the header's popover (result-map-tuning.ts) re-lay out the drawn results
// from their kept vectors — no re-search, no re-fetch.
//
// The pure parts (visibility, stale-drop, label choice/placement, colour slot) are
// exported for unit tests; the DOM class is covered by the real-Obsidian e2e.

import type { ScoredChunk } from './types';
import {
    buildClusterGraph, MIN_VECTORS_FOR_GRAPH,
    type ClusterGraphEdge, type ClusterGraphInput, type ClusterGraphModel, type ClusterGraphNode,
    type ClusterGraphOptions, type GraphSize,
} from './result-cluster-model';
import { ResultMapTuningPopover } from './result-map-tuning';

// ── visibility ──────────────────────────────────────────────────────────────

// Below this window width the modal keeps today's list-only width. Must stay ≥
// (list 640px + map 400px) / 0.94 ≈ 1107px — the `.seeker-has-map` width in
// styles.css is min(1040px, 94vw) — so the list never narrows below 640px.
export const MIN_WINDOW_WIDTH_FOR_MAP_PX = 1120;

export interface ResultMapAvailability {
    isMobile: boolean;
    // SeekerSettings.showResultMap
    showResultMap: boolean;
}

// Per modal open: may this modal ever show the map? False → no panel DOM at all.
export function resultMapAvailable(a: ResultMapAvailability): boolean {
    return !a.isMobile && a.showResultMap;
}

export interface ResultMapFit {
    windowWidth: number;
    resultCount: number;
}

// Per result set: is there room, and anything to compare? False → no panel, no
// vector fetch, today's modal width.
export function resultMapFits(f: ResultMapFit): boolean {
    return f.windowWidth >= MIN_WINDOW_WIDTH_FOR_MAP_PX && f.resultCount >= MIN_VECTORS_FOR_GRAPH;
}

// ── loading (after paint, stale-drop) ───────────────────────────────────────

export interface ResultMapLoaderDeps {
    // Resolves once the browser has painted the frame that holds the list.
    afterPaint(): Promise<void>;
    // Aligned to `results`; null = no stored vector (SearchOrchestrator.resultVectors).
    fetchVectors(results: readonly ScoredChunk[]): Promise<Array<Float32Array | null>>;
    // The drawing area's size, read after paint (when the panel has its layout).
    measure(): GraphSize;
    // The live tuning, read at every build. Must be COMPLETE (see completeClusterGraphOptions).
    options(): ClusterGraphOptions;
}

// Latest-wins loader: every load() supersedes the previous one, and cancel()
// supersedes them all. A superseded load resolves null instead of a model, so a
// newer query never shows an older query's graph. The last completed load's
// vectors are kept so relayout() can apply new tuning without a re-fetch.
export class ResultMapLoader {
    private generation = 0;
    // The graph input of the last COMPLETED load; null while a newer load is in
    // flight (its results replace these) or after cancel().
    private loaded: ClusterGraphInput | null = null;

    constructor(private readonly deps: ResultMapLoaderDeps) {}

    cancel(): void {
        this.generation++;
        this.loaded = null;
    }

    // Throws only for the CURRENT load; a superseded load's failure resolves null.
    async load(results: readonly ScoredChunk[]): Promise<ClusterGraphModel | null> {
        const generation = ++this.generation;
        this.loaded = null;
        const isCurrent = (): boolean => generation === this.generation;
        try {
            await this.deps.afterPaint();
            if (!isCurrent()) return null;
            const vectors = await this.deps.fetchVectors(results);
            if (!isCurrent()) return null;
            const input: ClusterGraphInput = { results, vectors, size: this.deps.measure() };
            const model = buildClusterGraph(input, this.deps.options());
            this.loaded = input;
            return model;
        } catch (e) {
            if (!isCurrent()) return null;
            throw e;
        }
    }

    // The last loaded results re-laid out with the CURRENT tuning, from the kept
    // vectors (no fetch, same size). Null when nothing is loaded — including while
    // a newer load is in flight, which reads the current tuning itself.
    relayout(): ClusterGraphModel | null {
        return this.loaded ? buildClusterGraph(this.loaded, this.deps.options()) : null;
    }
}

// ── labels + colours ────────────────────────────────────────────────────────

// Always-labelled nodes: the best few, so the map reads without hovering. The
// selected node is labelled too (that is how hover shows a title).
export const PINNED_LABEL_COUNT = 5;
const LABEL_MAX_CHARS = 32;
// Gap between a node's edge and its label, and the label's keep-out from the panel edge.
const LABEL_GAP_PX = 4;
const LABEL_EDGE_PAD_PX = 4;

// Result indices whose label is always shown: the first PINNED_LABEL_COUNT nodes
// in rank order (nodes are already rank-ordered by the model).
export function pinnedLabelIndices(nodes: readonly Pick<ClusterGraphNode, 'resultIndex'>[]): Set<number> {
    return new Set(nodes.slice(0, PINNED_LABEL_COUNT).map(n => n.resultIndex));
}

export function truncateLabel(title: string): string {
    return title.length > LABEL_MAX_CHARS ? `${title.slice(0, LABEL_MAX_CHARS - 1)}…` : title;
}

export interface LabelPlacement {
    x: number;
    anchor: 'start' | 'end';
}

// Right of the node by default; flipped to its left when the text would run past
// the panel's right edge (labels are clipped by the SVG otherwise).
export function labelPlacement(nodeX: number, nodeRadius: number, textWidth: number, panelWidth: number): LabelPlacement {
    const offset = nodeRadius + LABEL_GAP_PX;
    const fitsRight = nodeX + offset + textWidth <= panelWidth - LABEL_EDGE_PAD_PX;
    return fitsRight ? { x: nodeX + offset, anchor: 'start' } : { x: nodeX - offset, anchor: 'end' };
}

// One CSS class per palette slot (styles.css maps each to an Obsidian --color-*
// variable, so the palette follows the theme in light and dark). Clusters beyond
// the palette wrap around; ids are size-ordered, so wrapped clusters are the small ones.
export const CLUSTER_PALETTE_SIZE = 8;

export function nodeColourClass(node: Pick<ClusterGraphNode, 'clusterId' | 'lexicalOnly'>): string {
    if (node.lexicalOnly) return 'is-lexical';
    if (node.clusterId === null) return 'is-unclustered';
    return `seeker-map-c${node.clusterId % CLUSTER_PALETTE_SIZE}`;
}

export function edgeTouches(edge: Pick<ClusterGraphEdge, 'source' | 'target'>, resultIndex: number): boolean {
    return edge.source === resultIndex || edge.target === resultIndex;
}

// ── panel (DOM) ─────────────────────────────────────────────────────────────

// Edge stroke from its relative similarity: the most similar pairs read strongest.
const EDGE_WIDTH_MIN_PX = 0.5;
const EDGE_WIDTH_SPAN_PX = 2;
const EDGE_OPACITY_MIN = 0.15;
const EDGE_OPACITY_SPAN = 0.5;
const QUERY_NODE_RADIUS_PX = 6;
// Small low-rank dots are hard to hit; an invisible ring widens the hover target.
const NODE_HIT_RADIUS_MIN_PX = 8;
const NODE_HIT_PADDING_PX = 3;
// Relevance guide rings: innermost (most relevant), halfway, outermost.
const GUIDE_RING_RELEVANCES = [1, 0.5, 0] as const;

// `data-map-state` values — also the e2e's wait condition.
export type ResultMapState = 'loading' | 'ready' | 'empty' | 'error';

export interface ResultMapCallbacks {
    // Pointer entered a node: the modal selects (and scrolls to) that row.
    onNodeHover(resultIndex: number): void;
    // Node clicked: the modal opens it exactly like a click on its row.
    onNodeClick(resultIndex: number, evt: MouseEvent): void;
    fetchVectors(results: readonly ScoredChunk[]): Promise<Array<Float32Array | null>>;
    reportFailure(context: string, e: unknown): void;
    // The live tuning (SeekerSettings.resultMapTuning), always complete.
    tuning(): ClusterGraphOptions;
    // Replace the live tuning in memory (the panel re-lays out itself).
    setTuning(options: ClusterGraphOptions): void;
    // Save the live tuning to plugin settings.
    persistTuning(): void;
    // Put focus back in the query field (the tuning popover closed under focus).
    focusQuery(): void;
}

interface PaintedNode {
    el: SVGGElement;
    label: SVGTextElement;
}

interface PaintedEdge {
    el: SVGLineElement;
    edge: ClusterGraphEdge;
}

export class ResultMapPanel {
    readonly el: HTMLElement;
    private readonly canvasEl: HTMLElement;
    private readonly messageEl: HTMLElement;
    private readonly loader: ResultMapLoader;
    private readonly tuning: ResultMapTuningPopover;
    // Titles of the results being loaded/drawn (aligned to them), kept for re-layouts.
    private titles: readonly string[] = [];
    private nodes = new Map<number, PaintedNode>();
    private edges: PaintedEdge[] = [];
    private nodeLayer: SVGGElement | null = null;
    private labelLayer: SVGGElement | null = null;
    private selected = 0;
    private visible = false;

    // `modalEl` carries `.seeker-has-map` (the wider modal) while the panel shows.
    constructor(parent: HTMLElement, private readonly modalEl: HTMLElement, private readonly callbacks: ResultMapCallbacks) {
        this.el = parent.createDiv({ cls: 'seeker-map' });
        // The map is pointer-only: a mousedown here would move focus off the query
        // field (the modal is keyboard-first), so swallow it. Clicks still fire.
        // Except the tuning popover's sliders and dropdown: they need focus to work.
        this.el.addEventListener('mousedown', e => {
            if (!this.tuning.takesPointerFocus(e.target)) e.preventDefault();
        });
        const head = this.el.createDiv({ cls: 'seeker-map-head' });
        head.createSpan({ cls: 'seeker-map-title', text: 'Result map' });
        this.tuning = new ResultMapTuningPopover(head, this.el, {
            current: () => this.callbacks.tuning(),
            update: options => {
                this.callbacks.setTuning(options);
                this.relayout();
            },
            persist: () => this.callbacks.persistTuning(),
            restoreFocus: () => this.callbacks.focusQuery(),
        });
        this.canvasEl = this.el.createDiv({ cls: 'seeker-map-canvas' });
        this.messageEl = this.el.createDiv({ cls: 'seeker-map-message' });
        // "grey" names both uncoloured kinds (a note like no other result, and a
        // title-only match): without it, grey reads as one more "alike" group.
        this.el.createDiv({ cls: 'seeker-map-caption', text: 'Nearer the centre = more relevant · same colour = alike · grey = not grouped' });
        this.loader = new ResultMapLoader({
            afterPaint: () => afterNextPaint(),
            fetchVectors: results => this.callbacks.fetchVectors(results),
            measure: () => ({ width: this.canvasEl.clientWidth, height: this.canvasEl.clientHeight }),
            options: () => this.callbacks.tuning(),
        });
        this.setVisible(false);
    }

    // Called right after the list painted `results`. Shows the panel (widening the
    // modal in the same frame as the list) and draws the graph once the vectors and
    // layout are ready. Hides instead when the window is too narrow or there is
    // nothing to compare. `titles` aligns to `results`.
    show(results: readonly ScoredChunk[], titles: readonly string[]): void {
        if (!resultMapFits({ windowWidth: activeWindow.innerWidth, resultCount: results.length })) {
            this.hide();
            return;
        }
        this.setVisible(true);
        // Keep the previous graph (dimmed, inert) until the new one replaces it — no flash.
        this.setState('loading');
        this.titles = titles;
        // A paint failure lands in the same catch as a fetch failure: the map shows
        // a plain message instead of a half-drawn graph.
        this.loader.load(results)
            .then(model => { if (model) this.paint(model); })
            .catch(e => this.fail(e));
    }

    // New tuning: redraw the CURRENT results from their kept vectors (no re-search,
    // no re-fetch). No-op while a load is in flight — that load reads the new tuning.
    private relayout(): void {
        if (!this.visible) return;
        try {
            const model = this.loader.relayout();
            if (model) this.paint(model);
        } catch (e) {
            this.fail(e);
        }
    }

    private fail(e: unknown): void {
        this.callbacks.reportFailure('result-map', e);
        this.clearGraph();
        this.setState('error', 'Couldn’t draw the map for these results.');
    }

    hide(): void {
        this.loader.cancel();
        this.setVisible(false);
        this.clearGraph();
    }

    destroy(): void {
        this.hide();
        this.el.remove();
    }

    // Paint `resultIndex` as the selected node (highlighted, labelled, edges lit).
    // Stored when no graph is drawn yet, and applied once one is.
    setSelected(resultIndex: number): void {
        this.selected = resultIndex;
        this.paintSelection();
    }

    private setVisible(visible: boolean): void {
        this.visible = visible;
        this.el.toggle(visible);
        this.modalEl.toggleClass('seeker-has-map', visible);
    }

    private setState(state: ResultMapState, message = ''): void {
        this.el.setAttr('data-map-state', state);
        this.messageEl.setText(message);
        this.messageEl.toggle(message.length > 0);
    }

    private clearGraph(): void {
        this.canvasEl.empty();
        this.nodes.clear();
        this.edges = [];
        this.nodeLayer = null;
        this.labelLayer = null;
    }

    private paint(model: ClusterGraphModel): void {
        const titles = this.titles;
        if (!this.visible) return;
        this.clearGraph();
        if (model.nodes.length === 0) {
            this.setState('empty', 'Not enough results to map.');
            return;
        }
        // The size the layout ran at (the model centres the query node in it).
        const width = model.centre.x * 2;
        const height = model.centre.y * 2;
        const svg = this.canvasEl.createSvg('svg', {
            cls: 'seeker-map-svg',
            attr: { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Result map' },
        });
        this.paintRings(svg, model);
        this.paintEdges(svg, model);
        this.nodeLayer = svg.createSvg('g');
        this.labelLayer = svg.createSvg('g', { cls: 'seeker-map-labels' });
        this.paintQueryNode(svg, model);
        const pinned = pinnedLabelIndices(model.nodes);
        for (const node of model.nodes) this.paintNode(node, titles[node.resultIndex] ?? '', pinned.has(node.resultIndex), width);
        this.setState('ready');
        this.paintSelection();
    }

    private paintRings(svg: SVGSVGElement, model: ClusterGraphModel): void {
        const layer = svg.createSvg('g', { cls: 'seeker-map-rings' });
        for (const relevance of GUIDE_RING_RELEVANCES) {
            const r = model.innerRadius + (1 - relevance) * (model.outerRadius - model.innerRadius);
            layer.createSvg('circle', { cls: 'seeker-map-ring', attr: { cx: model.centre.x, cy: model.centre.y, r } });
        }
    }

    private paintEdges(svg: SVGSVGElement, model: ClusterGraphModel): void {
        const layer = svg.createSvg('g', { cls: 'seeker-map-edges' });
        const at = new Map(model.nodes.map(n => [n.resultIndex, n]));
        for (const edge of model.edges) {
            const a = at.get(edge.source);
            const b = at.get(edge.target);
            if (!a || !b) continue;
            const el = layer.createSvg('line', {
                cls: 'seeker-map-edge',
                attr: {
                    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                    'stroke-width': EDGE_WIDTH_MIN_PX + EDGE_WIDTH_SPAN_PX * edge.weight,
                    'stroke-opacity': EDGE_OPACITY_MIN + EDGE_OPACITY_SPAN * edge.weight,
                },
            });
            this.edges.push({ el, edge });
        }
    }

    private paintQueryNode(svg: SVGSVGElement, model: ClusterGraphModel): void {
        const q = svg.createSvg('circle', {
            cls: 'seeker-map-query',
            attr: { cx: model.centre.x, cy: model.centre.y, r: QUERY_NODE_RADIUS_PX },
        });
        q.createSvg('title').textContent = 'Your query';
    }

    private paintNode(node: ClusterGraphNode, title: string, pinned: boolean, panelWidth: number): void {
        if (!this.nodeLayer || !this.labelLayer) return;
        const g = this.nodeLayer.createSvg('g', {
            cls: ['seeker-map-node', nodeColourClass(node)],
            attr: { 'data-result-index': node.resultIndex },
        });
        g.createSvg('title').textContent = `#${node.resultIndex + 1} ${title}`;
        g.createSvg('circle', {
            cls: 'seeker-map-hit',
            attr: { cx: node.x, cy: node.y, r: Math.max(NODE_HIT_RADIUS_MIN_PX, node.radius + NODE_HIT_PADDING_PX) },
        });
        g.createSvg('circle', { cls: 'seeker-map-dot', attr: { cx: node.x, cy: node.y, r: node.radius } });
        g.addEventListener('mouseenter', () => this.callbacks.onNodeHover(node.resultIndex));
        g.addEventListener('click', e => this.callbacks.onNodeClick(node.resultIndex, e));

        const label = this.labelLayer.createSvg('text', {
            cls: pinned ? ['seeker-map-label', 'is-pinned'] : 'seeker-map-label',
            attr: { x: node.x, y: node.y, dy: '0.35em' },
        });
        label.textContent = truncateLabel(title);
        // Measured after insertion (hidden labels use visibility, so they still have
        // a box); placement flips left when the text would clip at the right edge.
        const place = labelPlacement(node.x, node.radius, label.getComputedTextLength(), panelWidth);
        label.setAttr('x', place.x);
        label.setAttr('text-anchor', place.anchor);
        this.nodes.set(node.resultIndex, { el: g, label });
    }

    private paintSelection(): void {
        for (const [index, painted] of this.nodes) {
            const isSelected = index === this.selected;
            painted.el.toggleClass('is-selected', isSelected);
            painted.label.toggleClass('is-selected', isSelected);
        }
        for (const { el, edge } of this.edges) el.toggleClass('is-highlighted', edgeTouches(edge, this.selected));
        // SVG has no z-index: re-append so the selected dot and label paint on top.
        const selected = this.nodes.get(this.selected);
        if (selected) {
            this.nodeLayer?.appendChild(selected.el);
            this.labelLayer?.appendChild(selected.label);
        }
    }
}

// Resolves after the browser painted the current frame: a rAF callback runs just
// BEFORE paint, and a timeout queued from it runs after. This is what keeps the
// vector fetch + ~20 ms layout off the list's first paint.
function afterNextPaint(): Promise<void> {
    return new Promise(resolve => {
        activeWindow.requestAnimationFrame(() => { activeWindow.setTimeout(resolve, 0); });
    });
}
