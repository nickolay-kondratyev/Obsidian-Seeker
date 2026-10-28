// The similar-notes panel's graph/list split: a drag handle between the graph
// (above) and the note list (below). Dragging it sets how much of the height the
// list gets; dragging it (nearly) to the bottom hides the list, so only the graph
// shows. The popover's "Show note list" checkbox is the other way to hide/show it.
//
// What we store is the LIST's share of the graph + list height
// (SeekerSettings.similarNotesListShare), not pixels: a sidebar's height changes
// with the window, and a share keeps the same look on every window. Hiding is a
// separate flag (SeekerSettings.similarNotesListCollapsed) so showing the list
// again restores the share it had before.
//
// WHY-NOT re-lay out on every pointermove: same as the modal's divider
// (result-map-divider.ts) — the force run (~20 ms) would stutter the drag. During
// the drag only the CSS split moves; the host re-lays out once on release.
//
// Pure parts (drag decision, persisted-value repair) are exported for unit tests;
// the DOM class is covered by the real-Obsidian e2e.

// Graph and list split the height evenly by default (the panel's look before the split).
export const DEFAULT_LIST_SHARE = 0.5;
// A list dragged shorter than this (about two rows) hides instead.
export const MIN_LIST_HEIGHT_PX = 64;
// Below this the graph is too cramped to tell groups apart.
export const MIN_GRAPH_HEIGHT_PX = 200;
// Shares are stored rounded: sub-pixel precision is noise in data.json.
const SHARE_DECIMALS = 3;

export interface ListSplit {
    // The list is hidden; only the graph shows.
    collapsed: boolean;
    // The list's share of the graph + list height (0..1, exclusive). Kept while
    // collapsed so showing the list again restores it.
    share: number;
}

// The split a drag sets when the list would be `listHeightPx` tall out of
// `totalPx` (graph + list). Too short a list hides it (keeping `keptShare` for when
// it shows again); otherwise the list keeps MIN_LIST_HEIGHT_PX and the graph
// MIN_GRAPH_HEIGHT_PX. If the panel cannot fit both, the list's minimum wins (the
// CSS min-height decides the overflow, not this).
export function splitForListHeight(listHeightPx: number, totalPx: number, keptShare: number): ListSplit {
    if (listHeightPx < MIN_LIST_HEIGHT_PX) return { collapsed: true, share: keptShare };
    // A panel with no height (never laid out) has no split to change.
    if (totalPx <= 0) return { collapsed: false, share: keptShare };
    const maxListPx = Math.max(MIN_LIST_HEIGHT_PX, totalPx - MIN_GRAPH_HEIGHT_PX);
    const listPx = Math.min(listHeightPx, maxListPx);
    return { collapsed: false, share: roundShare(Math.min(listPx / totalPx, maxShare())) };
}

// The persisted share as a usable number: a missing, non-numeric or out-of-range
// value (older install, hand-edited data.json) falls back to the default.
export function listShareFromPersisted(persisted: unknown): number {
    if (typeof persisted !== 'number' || !Number.isFinite(persisted) || persisted <= 0 || persisted >= 1) {
        return DEFAULT_LIST_SHARE;
    }
    return persisted;
}

function roundShare(share: number): number {
    const scale = 10 ** SHARE_DECIMALS;
    return Math.round(share * scale) / scale;
}

// The largest share below 1 at the stored precision: a share of 1 would mean "no
// graph" and is out of listShareFromPersisted's range.
function maxShare(): number {
    return 1 - 10 ** -SHARE_DECIMALS;
}

export interface GraphListDividerDeps {
    // The live split (SeekerSettings.similarNotesListShare + similarNotesListCollapsed).
    current(): ListSplit;
    // Paint `split` without saving it (per pointermove while dragging).
    preview(split: ListSplit): void;
    // A drag (or reset) settled on `split`: keep it, save it, re-lay out the graph.
    commit(split: ListSplit): void;
}

const DRAGGING_CLASS = 'is-dragging';

interface DividerDrag {
    // Pointer y, the list's rendered height (0 when hidden) and graph + list height at pointerdown.
    startY: number;
    startListHeight: number;
    total: number;
    start: ListSplit;
    // The split the drag has set so far.
    split: ListSplit;
}

export class GraphListDivider {
    readonly el: HTMLElement;
    // The drag in progress; null when idle.
    private drag: DividerDrag | null = null;

    // `mapEl` (the graph) holds the handle on its bottom edge — inside the graph,
    // like the modal's divider, so it never covers the list's scrollbar and hides
    // with the graph; `listEl` is the list below it.
    constructor(
        private readonly mapEl: HTMLElement,
        private readonly listEl: HTMLElement,
        private readonly deps: GraphListDividerDeps,
    ) {
        this.el = mapEl.createDiv({
            cls: 'seeker-similar-divider',
            attr: {
                role: 'separator',
                'aria-orientation': 'horizontal',
                // Obsidian shows aria-label as the hover tooltip (a title would double it).
                'aria-label': 'Drag to resize the list · drag to the bottom to hide it · double-click to reset',
            },
        });
        // One source for the minimum: the CSS min-height reads it.
        mapEl.style.setProperty('--seeker-similar-graph-min-height', `${MIN_GRAPH_HEIGHT_PX}px`);
        this.el.addEventListener('pointerdown', e => this.start(e));
        this.el.addEventListener('pointermove', e => this.move(e));
        this.el.addEventListener('pointerup', () => this.end());
        // Capture lost (pointercancel, window blur): settle on where the drag got to.
        this.el.addEventListener('lostpointercapture', () => this.end());
        this.el.addEventListener('dblclick', () => this.deps.commit({ collapsed: false, share: DEFAULT_LIST_SHARE }));
    }

    private start(e: PointerEvent): void {
        if (e.button !== 0) return;
        // No text selection while dragging across the list.
        e.preventDefault();
        this.el.setPointerCapture(e.pointerId);
        const start = this.deps.current();
        const startListHeight = this.listEl.offsetHeight;
        this.drag = { startY: e.clientY, startListHeight, total: this.mapEl.offsetHeight + startListHeight, start, split: start };
        this.el.addClass(DRAGGING_CLASS);
    }

    private move(e: PointerEvent): void {
        const drag = this.drag;
        if (!drag) return;
        // Dragging UP grows the list.
        drag.split = splitForListHeight(drag.startListHeight + drag.startY - e.clientY, drag.total, drag.start.share);
        this.deps.preview(drag.split);
    }

    private end(): void {
        const drag = this.drag;
        if (!drag) return;
        this.drag = null;
        this.el.removeClass(DRAGGING_CLASS);
        const changed = drag.split.collapsed !== drag.start.collapsed || drag.split.share !== drag.start.share;
        if (changed) this.deps.commit(drag.split);
    }
}
