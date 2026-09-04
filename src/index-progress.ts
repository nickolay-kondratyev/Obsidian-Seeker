// src/index-progress.ts — structured, per-type (notes vs images) indexing
// progress. WHY this exists (and why it is separate from the free-form
// `onProgress` string channel it rides alongside): two UI consumers — the
// settings-tab reindex card and the status-bar item (ticket 2/3) — need per-type
// FILE COUNTS, not a regex parse of a human sentence. The string channel stays
// for logs, toasts and the e2e suite (`e2e/search.e2e.ts` REINDEX_DONE_PATTERN);
// this event is additive.
//
// INVARIANT: `done` may legitimately end BELOW `total` (files skipped on error,
// images still waiting for OCR text, budget-deferred bursts). Completion is
// therefore signalled by the TASK CONTEXT popping — never by `done === total`.
// A consumer that paints a "finished" state off these counts alone would lie.

// Pure, Obsidian-free.

export type IndexProgressPhase = 'ocr' | 'embed';

export interface FileTypeProgress {
    done: number;
    total: number;
}

export interface IndexProgressEvent {
    phase: IndexProgressPhase;
    notes: FileTypeProgress;    // md / .base / .canvas
    images: FileTypeProgress;   // raster images (isIndexableImagePath)
    paused: boolean;            // full-pass preempt wait ("paused while you search")
}

export type IndexProgressListener = (e: IndexProgressEvent) => void;

// A throwing UI listener must NEVER break the index loop, so every emit() call is
// wrapped per-listener in try/catch. Errors route to the injected `onListenerError`
// (console.error by default) so a bug in one consumer is visible without taking the
// indexing pass — or the other listeners — down with it.
export class IndexProgressEmitter {
    private listeners = new Set<IndexProgressListener>();

    constructor(private readonly onListenerError: (e: unknown) => void = (e) => console.error('[seeker] index-progress listener threw', e)) {}

    // subscribe returns an unsubscribe fn; calling it removes exactly this listener.
    subscribe(listener: IndexProgressListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    emit(e: IndexProgressEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(e);
            } catch (err) {
                this.onListenerError(err);
            }
        }
    }
}

// Pure label for the settings card (see settings-tab.ts):
//   embed, no images:   "80 / 90 notes"
//   embed, with images: "80 / 90 notes · 10 / 30 images"
//   ocr:                "OCR 3 / 12 images"
// Counts are thousands-grouped to match the settings card's other figures.
export function progressLabel(e: IndexProgressEvent): string {
    const n = (x: number) => x.toLocaleString();
    if (e.phase === 'ocr') return `OCR ${n(e.images.done)} / ${n(e.images.total)} images`;
    const notes = `${n(e.notes.done)} / ${n(e.notes.total)} notes`;
    return e.images.total > 0 ? `${notes} · ${n(e.images.done)} / ${n(e.images.total)} images` : notes;
}
