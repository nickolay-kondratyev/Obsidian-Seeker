// The cluster graph painter, host-agnostic: the search modal's result map
// (result-map-panel.ts) hosts it beside the list, and any other host (e.g. a
// sidebar view) can construct it with just a parent element + callbacks.
// result-cluster-model.ts computes the graph; this module fetches vectors + lays
// out only AFTER the host has painted (ResultMapLoader), drops stale loads, paints
// the SVG (rings, edges, centre node, nodes, labels) and reports node hover/click.
// The host owns the selection; the graph only paints whatever index it is given
// (node index == result index). Tuning changes from the header's popover
// (result-map-tuning.ts) re-lay out the drawn results from their kept vectors —
// no re-fetch — and so does relayout() (the host calls it on a resize).
//
// Host concerns stay with the host: when the graph fits, the modal width class,
// the list/map divider, where focus goes (see result-map-panel.ts for the modal).
//
// The pure parts (stale-drop loader, label choice/placement, colour slot) are
// exported for unit tests; the DOM class is covered by the real-Obsidian e2e.

import type { ScoredChunk } from './types';
import {
    buildClusterGraph,
    type ClusterGraphEdge, type ClusterGraphInput, type ClusterGraphModel, type ClusterGraphNode,
    type ClusterGraphOptions, type GraphSize,
} from './result-cluster-model';
import { ResultMapTuningPopover, type TuningPopoverExtension } from './result-map-tuning';

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
// vectors are kept so relayout() can apply new tuning or a new size without a re-fetch.
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

    // The last loaded results re-laid out with the CURRENT tuning and drawing-area
    // size (re-measured), from the kept vectors (no fetch). Null when nothing is
    // loaded — including while a newer load is in flight, which reads both itself.
    relayout(): ClusterGraphModel | null {
        if (!this.loaded) return null;
        this.loaded = { ...this.loaded, size: this.deps.measure() };
        return buildClusterGraph(this.loaded, this.deps.options());
    }
}

// ── labels + colours ────────────────────────────────────────────────────────

// Only the selected node shows its label (hovering a node selects it, so hover
// shows a title too). WHY-NOT always-on labels for the top few: they cluttered the map.
const LABEL_MAX_CHARS = 32;
// Gap between a node's edge and its label, and the label's keep-out from the panel edge.
const LABEL_GAP_PX = 4;
const LABEL_EDGE_PAD_PX = 4;

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

// ── graph (DOM) ─────────────────────────────────────────────────────────────

// Edge stroke from its relative similarity: the most similar pairs read strongest.
const EDGE_WIDTH_MIN_PX = 0.5;
const EDGE_WIDTH_SPAN_PX = 2;
const EDGE_OPACITY_MIN = 0.15;
const EDGE_OPACITY_SPAN = 0.5;
const CENTRE_NODE_RADIUS_PX = 6;
// Small low-rank dots are hard to hit; an invisible ring widens the hover target.
const NODE_HIT_RADIUS_MIN_PX = 8;
const NODE_HIT_PADDING_PX = 3;
// Relevance guide rings: innermost (most relevant), halfway, outermost.
const GUIDE_RING_RELEVANCES = [1, 0.5, 0] as const;

// `data-map-state` values — also the e2e's wait condition.
export type ResultMapState = 'loading' | 'ready' | 'empty' | 'error';

// The host's words for what the graph shows: the centre node is whatever the
// host ranks against (the modal's query, a sidebar's active note).
export interface ResultMapGraphCopy {
    // Header title, also the SVG's accessible name.
    title: string;
    // Hover tooltip of the centre node.
    centreLabel: string;
    // One line under the graph explaining distance and colour.
    caption: string;
}

export interface ResultMapGraphCallbacks {
    // Pointer entered a node: the host selects that result (and calls setSelected).
    onNodeHover(resultIndex: number): void;
    // Node clicked: the host opens that result.
    onNodeClick(resultIndex: number, evt: MouseEvent): void;
    fetchVectors(results: readonly ScoredChunk[]): Promise<Array<Float32Array | null>>;
    // Drawing failed (vector fetch, layout or paint); the graph already shows a message.
    reportFailure(e: unknown): void;
    // The live tuning, always complete.
    tuning(): ClusterGraphOptions;
    // Replace the live tuning in memory (the graph re-lays out itself).
    setTuning(options: ClusterGraphOptions): void;
    // The user settled on a tuning value: save it.
    persistTuning(): void;
    // The tuning popover closed while one of its controls had focus: move focus
    // where the host wants it.
    restoreFocus(): void;
    // Host-only controls at the top of the tuning popover (see TuningPopoverDeps).
    buildTuningExtension?(container: HTMLElement): TuningPopoverExtension;
}

interface PaintedNode {
    el: SVGGElement;
    label: SVGTextElement;
}

interface PaintedEdge {
    el: SVGLineElement;
    edge: ClusterGraphEdge;
}

export class ResultMapGraph {
    // The graph's root (`.seeker-map`): the host may add its own children/listeners.
    readonly el: HTMLElement;
    private readonly canvasEl: HTMLElement;
    private readonly messageEl: HTMLElement;
    private readonly loader: ResultMapLoader;
    private readonly tuningPopover: ResultMapTuningPopover;
    // Titles of the results being loaded/drawn (aligned to them), kept for re-layouts.
    private titles: readonly string[] = [];
    private nodes = new Map<number, PaintedNode>();
    private edges: PaintedEdge[] = [];
    private nodeLayer: SVGGElement | null = null;
    private labelLayer: SVGGElement | null = null;
    private selected = 0;
    private visible = false;

    // Starts hidden; show() reveals it.
    constructor(parent: HTMLElement, private readonly copy: ResultMapGraphCopy, private readonly callbacks: ResultMapGraphCallbacks) {
        this.el = parent.createDiv({ cls: 'seeker-map' });
        const head = this.el.createDiv({ cls: 'seeker-map-head' });
        head.createSpan({ cls: 'seeker-map-title', text: copy.title });
        const buildTuningExtension = callbacks.buildTuningExtension;
        this.tuningPopover = new ResultMapTuningPopover(head, this.el, {
            current: () => this.callbacks.tuning(),
            update: options => {
                this.callbacks.setTuning(options);
                this.relayout();
            },
            persist: () => this.callbacks.persistTuning(),
            restoreFocus: () => this.callbacks.restoreFocus(),
            buildExtension: buildTuningExtension ? container => buildTuningExtension(container) : undefined,
        });
        this.canvasEl = this.el.createDiv({ cls: 'seeker-map-canvas' });
        this.messageEl = this.el.createDiv({ cls: 'seeker-map-message' });
        this.el.createDiv({ cls: 'seeker-map-caption', text: copy.caption });
        this.loader = new ResultMapLoader({
            afterPaint: () => afterNextPaint(),
            fetchVectors: results => this.callbacks.fetchVectors(results),
            measure: () => ({ width: this.canvasEl.clientWidth, height: this.canvasEl.clientHeight }),
            options: () => this.callbacks.tuning(),
        });
        this.setVisible(false);
    }

    // Does a mousedown on `target` need to take focus (a tuning slider/dropdown)?
    // For hosts that swallow every other mousedown to keep focus elsewhere.
    takesPointerFocus(target: EventTarget | null): boolean {
        return this.tuningPopover.takesPointerFocus(target);
    }

    // Shows the graph and draws `results` once their vectors and layout are ready
    // (after the host's next paint). `titles` aligns to `results`.
    show(results: readonly ScoredChunk[], titles: readonly string[]): void {
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

    // New tuning or size: redraw the CURRENT results from their kept vectors (no
    // re-search, no re-fetch). No-op while hidden or while a load is in flight —
    // that load reads both.
    relayout(): void {
        if (!this.visible) return;
        try {
            const model = this.loader.relayout();
            if (model) this.paint(model);
        } catch (e) {
            this.fail(e);
        }
    }

    // Shows the graph area with `message` in place of a graph (no results to
    // draw); a load in flight is dropped.
    showMessage(message: string): void {
        this.loader.cancel();
        this.setVisible(true);
        this.clearGraph();
        this.setState('empty', message);
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

    private fail(e: unknown): void {
        this.callbacks.reportFailure(e);
        this.clearGraph();
        this.setState('error', 'Couldn’t draw the map for these results.');
    }

    private setVisible(visible: boolean): void {
        this.visible = visible;
        this.el.toggle(visible);
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
        // The size the layout ran at (the model centres the centre node in it).
        const width = model.centre.x * 2;
        const height = model.centre.y * 2;
        const svg = this.canvasEl.createSvg('svg', {
            cls: 'seeker-map-svg',
            attr: { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': this.copy.title },
        });
        this.paintRings(svg, model);
        this.paintEdges(svg, model);
        this.nodeLayer = svg.createSvg('g');
        this.labelLayer = svg.createSvg('g', { cls: 'seeker-map-labels' });
        this.paintCentreNode(svg, model);
        for (const node of model.nodes) this.paintNode(node, titles[node.resultIndex] ?? '', width);
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

    private paintCentreNode(svg: SVGSVGElement, model: ClusterGraphModel): void {
        const centre = svg.createSvg('circle', {
            cls: 'seeker-map-query',
            attr: { cx: model.centre.x, cy: model.centre.y, r: CENTRE_NODE_RADIUS_PX },
        });
        centre.createSvg('title').textContent = this.copy.centreLabel;
    }

    private paintNode(node: ClusterGraphNode, title: string, panelWidth: number): void {
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
            cls: 'seeker-map-label',
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
