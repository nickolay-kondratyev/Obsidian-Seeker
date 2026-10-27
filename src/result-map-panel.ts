// The desktop result map: the search modal's cluster graph, drawn beside the
// result list (plan: _tickets/plan-desktop-result-cluster-graph-beside-the-search-list.md).
// The graph itself (loading, painting, tuning popover) is the host-agnostic
// result-map-graph.ts; this module is its MODAL host: it decides WHEN the map
// shows (desktop, setting on, window wide enough), widens the modal while it does,
// adds the list/map divider (result-map-divider.ts), keeps focus in the query
// field, and re-lays out after a divider drag or window resize. Node index ==
// result index == list row: the modal owns the selection (its selectedIndex).
//
// The map shows from the moment the modal opens — a placeholder until there are
// results to draw — and stays through every state in between. WHY-NOT show it
// only while results are drawn: the centred modal widened and narrowed with it,
// so the query field and list jumped sideways on every search.
//
// The pure visibility parts are exported for unit tests; the DOM class is covered
// by the real-Obsidian e2e.

import type { ScoredChunk } from './types';
import { MIN_VECTORS_FOR_GRAPH, type ClusterGraphOptions } from './result-cluster-model';
import { ResultMapGraph, type ResultMapGraphCopy } from './result-map-graph';
import { ListMapDivider } from './result-map-divider';

// ── visibility ──────────────────────────────────────────────────────────────

// Below this window width the modal keeps today's list-only width. Must stay ≥
// (DEFAULT_LIST_WIDTH_PX + MIN_DEFAULT_MAP_WIDTH_PX) / MAP_MODAL_VIEWPORT_SHARE ≈
// 1107px (unit-tested) — the `.seeker-has-map` width in styles.css is
// min(1600px, 94vw) — so the default split never narrows the list below today's
// 640px nor starts the map below 400px. A dragged split is clamped by the divider.
export const MIN_WINDOW_WIDTH_FOR_MAP_PX = 1120;
// The smallest map the DEFAULT split shows at MIN_WINDOW_WIDTH_FOR_MAP_PX.
export const MIN_DEFAULT_MAP_WIDTH_PX = 400;
// Share of the window the map-showing modal may take: the `94vw` in styles.css.
export const MAP_MODAL_VIEWPORT_SHARE = 0.94;

export interface ResultMapAvailability {
    isMobile: boolean;
    // SeekerSettings.showResultMap
    showResultMap: boolean;
}

// Per modal open: may this modal ever show the map? False → no panel DOM at all.
export function resultMapAvailable(a: ResultMapAvailability): boolean {
    return !a.isMobile && a.showResultMap;
}

// Is the window wide enough for the map? False → no panel, today's modal width.
// Re-checked on window resize only, never per result set, so the modal's width
// (and the query field's position) holds still while searching.
export function resultMapFits(windowWidth: number): boolean {
    return windowWidth >= MIN_WINDOW_WIDTH_FOR_MAP_PX;
}

// Is there anything to compare? False → the map shows a placeholder message
// instead of fetching vectors for a graph.
export function resultMapHasGraph(resultCount: number): boolean {
    return resultCount >= MIN_VECTORS_FOR_GRAPH;
}

// ── panel (DOM): the graph's modal host ─────────────────────────────────────

// A window drag fires resize per frame; re-lay out (~20 ms force run) once it settles.
const WINDOW_RESIZE_RELAYOUT_DEBOUNCE_MS = 150;

// The modal ranks against the typed query, so the centre node is the query.
const RESULT_MAP_COPY: ResultMapGraphCopy = {
    title: 'Result map',
    centreLabel: 'Your query',
    // "grey" names both uncoloured kinds (a note like no other result, and a
    // title-only match): without it, grey reads as one more "alike" group.
    caption: 'Nearer the centre = more relevant · same colour = alike · grey = not grouped',
};
// Placeholder copy while the map shows without a graph.
const NO_RESULTS_MESSAGE = 'Search results appear here as a map.';
const TOO_FEW_RESULTS_MESSAGE = 'Not enough results to map.';

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
    // The saved list width beside the map (SeekerSettings.resultMapListWidthPx).
    listWidth(): number;
    // Replace the list width in memory (the panel re-lays out itself).
    setListWidth(px: number): void;
    // Save the live settings (tuning, list width) to plugin settings.
    persistSettings(): void;
    // Put focus back in the query field (the tuning popover closed under focus).
    focusQuery(): void;
}

export class ResultMapPanel {
    private readonly graph: ResultMapGraph;
    // The modal's own window (a popout's, not whichever is active at destroy time),
    // so the resize listener is removed from the window it was added to.
    private readonly win: Window;
    // Pending debounced re-layout after a window resize; 0 = none.
    private resizeTimer = 0;
    // Does the map show (window wide enough)? Null until the first layout.
    private wide: boolean | null = null;
    // The results the map currently stands for (empty = placeholder), kept so a
    // resize back above the threshold can redraw them.
    private results: readonly ScoredChunk[] = [];
    private titles: readonly string[] = [];
    private readonly onWindowResize = (): void => {
        this.win.clearTimeout(this.resizeTimer);
        this.resizeTimer = this.win.setTimeout(() => this.onWindowResized(), WINDOW_RESIZE_RELAYOUT_DEBOUNCE_MS);
    };

    // `parent` is the list + map row; `modalEl` carries `.seeker-has-map` (the
    // wider modal) while the panel shows.
    constructor(parent: HTMLElement, private readonly modalEl: HTMLElement, callbacks: ResultMapCallbacks) {
        this.win = parent.win;
        this.graph = new ResultMapGraph(parent, RESULT_MAP_COPY, {
            onNodeHover: i => callbacks.onNodeHover(i),
            onNodeClick: (i, e) => callbacks.onNodeClick(i, e),
            fetchVectors: results => callbacks.fetchVectors(results),
            reportFailure: e => callbacks.reportFailure('result-map', e),
            tuning: () => callbacks.tuning(),
            setTuning: options => callbacks.setTuning(options),
            persistTuning: () => callbacks.persistSettings(),
            restoreFocus: () => callbacks.focusQuery(),
        });
        // The map is pointer-only: a mousedown here would move focus off the query
        // field (the modal is keyboard-first), so swallow it. Clicks still fire.
        // Except the tuning popover's sliders and dropdown: they need focus to work.
        this.graph.el.addEventListener('mousedown', e => {
            if (!this.graph.takesPointerFocus(e.target)) e.preventDefault();
        });
        new ListMapDivider(this.graph.el, parent, {
            listWidth: () => callbacks.listWidth(),
            commit: px => {
                callbacks.setListWidth(px);
                callbacks.persistSettings();
                this.graph.relayout();
            },
        });
        // The modal only resizes with its window; re-lay out once that settles.
        this.win.addEventListener('resize', this.onWindowResize);
        this.applyFit();
    }

    // Called right after the list painted `results`. Draws the graph once the
    // vectors and layout are ready, or a placeholder when there is nothing to
    // compare. `titles` aligns to `results`.
    show(results: readonly ScoredChunk[], titles: readonly string[]): void {
        this.results = results;
        this.titles = titles;
        this.render();
    }

    // The list shows no results (resting, loading, no matches, …): the map stays,
    // showing its placeholder.
    clear(): void {
        this.show([], []);
    }

    destroy(): void {
        this.win.removeEventListener('resize', this.onWindowResize);
        this.win.clearTimeout(this.resizeTimer);
        this.setWide(false);
        this.graph.destroy();
    }

    // Paint `resultIndex` as the selected node (see ResultMapGraph.setSelected).
    setSelected(resultIndex: number): void {
        this.graph.setSelected(resultIndex);
    }

    private onWindowResized(): void {
        const wasWide = this.wide;
        this.applyFit();
        // Crossing the threshold already redrew (or hid) the map.
        if (this.wide === wasWide) this.graph.relayout();
    }

    // Shows or hides the map (and widens the modal) for the current window width.
    private applyFit(): void {
        const wide = resultMapFits(this.win.innerWidth);
        if (wide === this.wide) return;
        this.wide = wide;
        this.setWide(wide);
        this.render();
    }

    private render(): void {
        if (!this.wide) {
            this.graph.hide();
        } else if (this.results.length === 0) {
            this.graph.showMessage(NO_RESULTS_MESSAGE);
        } else if (!resultMapHasGraph(this.results.length)) {
            this.graph.showMessage(TOO_FEW_RESULTS_MESSAGE);
        } else {
            this.graph.show(this.results, this.titles);
        }
    }

    private setWide(wide: boolean): void {
        this.modalEl.toggleClass('seeker-has-map', wide);
    }
}
