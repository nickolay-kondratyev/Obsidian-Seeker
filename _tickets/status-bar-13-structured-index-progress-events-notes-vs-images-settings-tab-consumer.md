---
id: nid_z8zzhahzmj7ioue0uc6wn4v3h_e
title: "Status bar 1/3: structured index-progress events (notes vs images) + settings-tab consumer"
status: open
deps: [nid_07petn152dbm3y13beujob1z3_e]
links: []
created_iso: 2026-09-03T23:18:05Z
status_updated_iso: 2026-09-03T23:18:05Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ui, indexing]
---

Part 1 of 3 of plan ticket nid_07petn152dbm3y13beujob1z3_e (read it first). Goal: give the UI a STRUCTURED, per-type (notes vs images) indexing progress signal, and make the settings tab consume it instead of regex-parsing a string.

## Background (facts, verified 2026-09-03)
- `src/search.ts` `SearchOrchestrator` reports progress ONLY as free-form strings via an `onProgress?: (msg: string) => void` parameter threaded through `reindexAll` (line ~411), `reindexDelta` (opts, line ~2106), `embedAndCommitFiles` (line ~659) and `ocrPrepass` (line ~1797). Emission sites: `src/search.ts` ~1138 (`… — paused while you search…`), ~1399 and ~1475 (`Indexed N files · M chunks`), ~1829 (`OCR done/total`). Cadence constants `PROGRESS_EVERY` / `PROGRESS_MAX_SILENCE_MS` at ~97-99. `filesCommitted++` happens at ~1039, ~1183, ~1249 (three commit branches).
- `src/settings-tab.ts` ~560-592: the reindex button sets `reindexTotal = collectIndexableFiles(...).length`, then parses `onProgress` messages with `msg.match(/Indexed\s+([\d,]+)\s+files/i)` into `reindexDone` and calls `paintProgress()`. It ignores the `OCR n/m` messages.
- `e2e/search.e2e.ts:36` also parses the string (`REINDEX_DONE_PATTERN`). It must keep working: DO NOT remove or change the string channel.
- Notes (md/.base/.canvas) and images are embedded in the SAME `embedAndCommitFiles` pass; images are classified by `isIndexableImagePath(path)` from `src/image-file.ts`. Images first go through `ocrPrepass` (desktop only, when `settings.indexImages` is on).
- The catch-up drain (`src/catchup.ts` `drainCatchUp`, called from `src/main.ts` `runCatchUp` ~1857) calls `reindexDelta` WITHOUT `onProgress`. A subscribe API on the orchestrator (below) means its progress flows without touching `catchup.ts`.
- vitest runs in node (no jsdom); `obsidian` is stubbed by `src/test-stubs/obsidian.ts`.

## Deliverables
1. New `src/index-progress.ts` (pure, Obsidian-free):
   ```ts
   export type IndexProgressPhase = 'ocr' | 'embed';
   export interface FileTypeProgress { done: number; total: number }
   export interface IndexProgressEvent {
       phase: IndexProgressPhase;
       notes: FileTypeProgress;    // md / .base / .canvas
       images: FileTypeProgress;   // raster images (isIndexableImagePath)
       paused: boolean;            // full-pass preempt wait ("paused while you search")
   }
   export type IndexProgressListener = (e: IndexProgressEvent) => void;
   // Small emitter class (subscribe returns an unsubscribe fn; listener errors are caught + logged, never propagate into the index loop).
   export class IndexProgressEmitter { ... }
   ```
   WHY comment at the top: two UI consumers (settings card, status bar) need per-type counts; the string channel stays for logs/toasts/e2e.
2. `SearchOrchestrator` gets a `readonly progress = new IndexProgressEmitter()` and a public `onIndexProgress(listener): () => void` delegating to it.
   - `embedAndCommitFiles`: compute up front `imagesTotal = files.filter(f => isIndexableImagePath(f.path)).length`, `notesTotal = files.length - imagesTotal`; keep `notesDone`/`imagesDone` counters incremented next to each `filesCommitted++` (classify by the file's path). Emit an event at EVERY place the string is emitted (the ~1138 paused site with `paused:true`, the ~1399 cadence site, the ~1475 end-of-pass site). Also emit once at pass start (done 0) so consumers learn the totals immediately.
   - `ocrPrepass`: emit `{ phase:'ocr', notes:{done:0,total:0}, images:{done, total: queue.length}, paused:false }` next to the existing `OCR done/total` string.
3. `src/settings-tab.ts`: delete the regex; subscribe via `this.plugin.onIndexProgress(...)` (add that thin passthrough on the plugin in `src/main.ts`, returning a no-op unsubscribe when the orchestrator is not ready) when the reindex starts, unsubscribe in the `.then/.catch` and in `hide()`. On an `'embed'` event set `reindexDone = notes.done + images.done`, `reindexTotal = notes.total + images.total`; on an `'ocr'` event paint `OCR n / m images` in the same label. Remove the now-unneeded `collectIndexableFiles` total computation if nothing else in the tab uses it (check imports).
4. Tests (BDD, one assert each, colocated):
   - `src/index-progress.test.ts`: subscribe/unsubscribe; a throwing listener does not break other listeners.
   - Extend an existing orchestrator-level test that runs a reindex (look at `src/image-indexing.test.ts` and `src/frame-incremental.test.ts` for harness usage; `src/test-harness/CLAUDE.md` explains the tier-2 harness): assert the last `'embed'` event has `notes.done === notes.total` equal to the note count, and with images enabled `images.total` equals the image count; assert an `'ocr'` event is emitted when the OCR engine stub is present (see how `image-indexing.test.ts` injects it).
   - Settings-tab: if there is an existing settings-tab test, add a case that a progress event updates the label; otherwise a focused test of whatever pure helper you extract for the label text (prefer extracting `progressLabel(event)` into `src/index-progress.ts` so it is testable and reusable by part 2).
5. `npm run typecheck`, `npm run test` green. Do NOT run the e2e suites here.
6. Update `src/CLAUDE.md` (Orchestration layer line: mention `index-progress.ts`, one clause). Record with `change_log` at the end.

## Non-goals
- No status bar in this ticket (part 2). No change to toast strings or the `onProgress` string channel.

