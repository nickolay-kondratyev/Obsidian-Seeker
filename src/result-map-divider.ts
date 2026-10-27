// The drag handle on the result map's left edge: resizes the list/map split.
//
// The LIST width is what we store (SeekerSettings.resultMapListWidthPx), not the
// map's: the map takes whatever the (wider) modal has left, so by default the list
// keeps today's 640px and every extra pixel goes to the map, and one saved value
// stays sensible on a smaller window (CSS min-widths shrink it, see styles.css).
//
// WHY-NOT re-lay out on every pointermove: a re-layout runs the force simulation
// (~20 ms), which would make the drag stutter. During the drag only the CSS split
// moves (the old drawing stays, clipped or with spare room); on release the panel
// re-lays out once for the new size.
//
// Pure parts (clamp, persisted-value repair) are exported for unit tests; the DOM
// class is covered by the real-Obsidian e2e.

// Today's list width: the default split keeps the list exactly as it was.
export const DEFAULT_LIST_WIDTH_PX = 640;
// Below this the result rows truncate titles to a few words.
export const MIN_LIST_WIDTH_PX = 400;
// Below this the graph is too cramped to tell groups apart.
export const MIN_MAP_WIDTH_PX = 320;

// The list width a drag may set inside a row `bodyWidthPx` wide: the list keeps
// MIN_LIST_WIDTH_PX and the map MIN_MAP_WIDTH_PX. If the row cannot fit both, the
// list's minimum wins (the CSS min-widths decide the overflow, not this).
export function clampListWidth(desiredPx: number, bodyWidthPx: number): number {
    const max = bodyWidthPx - MIN_MAP_WIDTH_PX;
    return Math.round(Math.max(MIN_LIST_WIDTH_PX, Math.min(desiredPx, max)));
}

// The persisted list width as a usable number: a missing, non-numeric or too-small
// value (older install, hand-edited data.json) falls back to the default. No upper
// bound here: the window it was saved on is unknown, so the CSS clamps it per window.
export function listWidthFromPersisted(persisted: unknown): number {
    if (typeof persisted !== 'number' || !Number.isFinite(persisted) || persisted < MIN_LIST_WIDTH_PX) {
        return DEFAULT_LIST_WIDTH_PX;
    }
    return Math.round(persisted);
}

export interface ListMapDividerDeps {
    // The saved list width (SeekerSettings.resultMapListWidthPx).
    listWidth(): number;
    // A drag (or reset) settled on a new width: keep it in memory, save it, re-lay out.
    commit(listWidthPx: number): void;
}

const DRAGGING_CLASS = 'is-dragging';

interface DividerDrag {
    // Pointer x and the list's rendered width at pointerdown.
    startX: number;
    startWidth: number;
    // The clamped width the drag has set so far.
    width: number;
}

export class ListMapDivider {
    readonly el: HTMLElement;
    // The drag in progress; null when idle.
    private drag: DividerDrag | null = null;

    // `mapEl` holds the handle on its left edge; `bodyEl` is the list + map row,
    // which carries the CSS variables the split reads.
    constructor(private readonly mapEl: HTMLElement, private readonly bodyEl: HTMLElement, private readonly deps: ListMapDividerDeps) {
        this.el = mapEl.createDiv({
            cls: 'seeker-map-divider',
            attr: {
                role: 'separator',
                'aria-orientation': 'vertical',
                // Obsidian shows aria-label as the hover tooltip (a title would double it).
                'aria-label': 'Drag to resize the map · double-click to reset',
            },
        });
        // One source for the minimums: the CSS min-widths read these.
        bodyEl.style.setProperty('--seeker-list-min-width', `${MIN_LIST_WIDTH_PX}px`);
        bodyEl.style.setProperty('--seeker-map-min-width', `${MIN_MAP_WIDTH_PX}px`);
        this.apply(deps.listWidth());
        // Focus stays in the query field: the map's own mousedown handler (which
        // contains this handle) swallows the mousedown that would move it.
        this.el.addEventListener('pointerdown', e => this.start(e));
        this.el.addEventListener('pointermove', e => this.move(e));
        this.el.addEventListener('pointerup', () => this.end());
        // Capture lost (pointercancel, window blur): settle on where the drag got to.
        this.el.addEventListener('lostpointercapture', () => this.end());
        this.el.addEventListener('dblclick', () => this.commit(DEFAULT_LIST_WIDTH_PX));
    }

    private apply(listWidthPx: number): void {
        this.bodyEl.style.setProperty('--seeker-list-width', `${listWidthPx}px`);
    }

    // The list's rendered width: what the user sees, which the CSS may have
    // shrunk below the saved value on a smaller window.
    private renderedListWidth(): number {
        return this.bodyEl.clientWidth - this.mapEl.offsetWidth;
    }

    private start(e: PointerEvent): void {
        if (e.button !== 0) return;
        e.preventDefault();
        this.el.setPointerCapture(e.pointerId);
        const width = this.renderedListWidth();
        this.drag = { startX: e.clientX, startWidth: width, width };
        this.el.addClass(DRAGGING_CLASS);
    }

    private move(e: PointerEvent): void {
        if (!this.drag) return;
        this.drag.width = clampListWidth(this.drag.startWidth + e.clientX - this.drag.startX, this.bodyEl.clientWidth);
        this.apply(this.drag.width);
    }

    private end(): void {
        const drag = this.drag;
        if (!drag) return;
        this.drag = null;
        this.el.removeClass(DRAGGING_CLASS);
        if (drag.width !== drag.startWidth) this.commit(drag.width);
    }

    private commit(listWidthPx: number): void {
        this.apply(listWidthPx);
        this.deps.commit(listWidthPx);
    }
}
