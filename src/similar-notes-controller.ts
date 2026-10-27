// The similar-notes panel's brain, pure and Obsidian-free: decides WHEN to query
// (visible, has an active note, and that note or the index changed since the last
// query), drops stale answers (latest wins), debounces index-changed bursts, and
// hands the view one state to paint. The view (similar-notes-view.ts) only wires
// Obsidian's signals in (active-leaf-change, layout-change, onIndexChanged) and
// paints the state out. Unit-tested here; the DOM is covered by the e2e.

import type { ScoredChunk } from './types';
import type { SimilarityMode } from './similar-notes';

// Why a query came back empty — each gets its own plain-language message.
export type SimilarNotesEmptyReason = 'no-index' | 'not-indexed' | 'none-similar';

export type SimilarNotesState =
    | { kind: 'no-note' }
    | { kind: 'loading'; notePath: string }
    | { kind: 'results'; notePath: string; results: ScoredChunk[] }
    | { kind: SimilarNotesEmptyReason; notePath: string }
    | { kind: 'error'; notePath: string };

export interface SimilarNotesControllerDeps {
    similarNotes(notePath: string, mode: SimilarityMode): Promise<ScoredChunk[]>;
    emptyReason(notePath: string): Promise<SimilarNotesEmptyReason>;
    // The live mode (SeekerSettings.similarNotesMode), read at every query.
    mode(): SimilarityMode;
    render(state: SimilarNotesState): void;
    // Timer for the index-changed debounce (the host passes its window's setTimeout).
    // Returns a cancel function.
    schedule(fn: () => void, ms: number): () => void;
    reportFailure(e: unknown): void;
}

// onIndexChanged fires once per index mutation — hundreds of times during a
// reindex. One re-query this long after the last bump is plenty: the panel is a
// glance surface, not a live feed.
export const INDEX_CHANGED_DEBOUNCE_MS = 1500;

export interface RefreshInputs {
    visible: boolean;
    activePath: string | null;
    // The note the last query was started for; null when nothing is shown.
    shownPath: string | null;
    // The index or the mode changed since the last query started.
    stale: boolean;
}

// The one gating rule: hidden → never; no note → never; otherwise only when what
// is shown is not what should be shown.
export function needsRefresh(i: RefreshInputs): boolean {
    return i.visible && i.activePath !== null && (i.stale || i.activePath !== i.shownPath);
}

export class SimilarNotesController {
    private visible = false;
    private activePath: string | null = null;
    private shownPath: string | null = null;
    private stale = false;
    // Latest-wins: every query (and every cancel) bumps it; an answer whose
    // generation is no longer current is dropped unseen.
    private generation = 0;
    private inFlight = false;
    private cancelIndexChange: (() => void) | null = null;

    constructor(private readonly deps: SimilarNotesControllerDeps) {}

    // The host's visibility verdict (collapsed sidebar / tab behind / detached =
    // false). Hiding cancels an in-flight query so showing again re-asks.
    setVisible(visible: boolean): void {
        if (visible === this.visible) return;
        this.visible = visible;
        if (!visible) this.cancelInFlight();
        this.reconcile();
    }

    setActiveNote(notePath: string | null): void {
        if (notePath === this.activePath) return;
        this.activePath = notePath;
        this.reconcile();
    }

    // The index changed (onIndexChanged): re-query once the burst settles.
    indexChanged(): void {
        if (this.cancelIndexChange) return;
        this.cancelIndexChange = this.deps.schedule(() => {
            this.cancelIndexChange = null;
            this.markStale();
        }, INDEX_CHANGED_DEBOUNCE_MS);
    }

    // The similarity mode changed: what is shown was computed the old way.
    modeChanged(): void {
        this.markStale();
    }

    dispose(): void {
        this.cancelIndexChange?.();
        this.cancelIndexChange = null;
        this.cancelInFlight();
    }

    private markStale(): void {
        this.stale = true;
        this.reconcile();
    }

    private cancelInFlight(): void {
        if (!this.inFlight) return;
        this.generation++;
        this.inFlight = false;
        // A cancelled query never painted, so nothing is shown.
        this.shownPath = null;
    }

    private reconcile(): void {
        if (!this.visible) return;
        if (this.activePath === null) {
            this.cancelInFlight();
            this.deps.render({ kind: 'no-note' });
            return;
        }
        if (needsRefresh({ visible: this.visible, activePath: this.activePath, shownPath: this.shownPath, stale: this.stale })) {
            void this.query(this.activePath);
        }
    }

    private async query(notePath: string): Promise<void> {
        const generation = ++this.generation;
        const isCurrent = (): boolean => generation === this.generation;
        this.inFlight = true;
        this.stale = false;
        this.shownPath = notePath;
        this.deps.render({ kind: 'loading', notePath });
        try {
            const results = await this.deps.similarNotes(notePath, this.deps.mode());
            if (!isCurrent()) return;
            if (results.length > 0) {
                this.settle(generation, { kind: 'results', notePath, results });
                return;
            }
            const reason = await this.deps.emptyReason(notePath);
            if (!isCurrent()) return;
            this.settle(generation, { kind: reason, notePath });
        } catch (e) {
            if (!isCurrent()) return;
            this.deps.reportFailure(e);
            this.settle(generation, { kind: 'error', notePath });
        }
    }

    // The current query finished: paint its state.
    private settle(generation: number, state: SimilarNotesState): void {
        if (generation !== this.generation) return;
        this.inFlight = false;
        this.deps.render(state);
    }
}
