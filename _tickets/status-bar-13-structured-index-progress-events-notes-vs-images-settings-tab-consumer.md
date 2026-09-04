---
closed_iso: 2026-09-03T23:40:21Z
session_ids: [{"a": "claude", "type": "execution", "id": "b51b060f-d624-44a0-afcb-682f6906e0e0"}, {"a": "claude", "type": "review", "id": "c3cb1d69-e74a-47c2-9920-521cc18c89f7"}, {"a": "claude", "type": "review", "id": "c14d373f-cba7-4c96-bac3-07a216ed8d2c"}, {"a": "claude", "type": "conflict-merge", "id": "5cd72fd7-16bb-463b-8876-56468e6e136a"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-3
id: nid_z8zzhahzmj7ioue0uc6wn4v3h_e
title: "Status bar 1/3: structured index-progress events (notes vs images) + settings-tab consumer"
status: closed
deps: [nid_07petn152dbm3y13beujob1z3_e]
links: []
created_iso: 2026-09-03T23:18:05Z
status_updated_iso: 2026-09-03T23:40:21Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ui, indexing]
---

Part 1 of 3 of plan ticket nid_07petn152dbm3y13beujob1z3_e (read it first, especially §Invariants). Goal: give the UI a STRUCTURED, per-type (notes vs images) indexing progress signal, and make the settings tab consume it instead of regex-parsing a string.

## Background (facts, verified 2026-09-03; line numbers are approximate — grep the symbols)
- `src/search.ts` `SearchOrchestrator` reports progress ONLY as free-form strings via an `onProgress?: (msg: string) => void` parameter threaded through `reindexAll` (~411), `reindexDelta` (opts, ~2106), `embedAndCommitFiles` (~656) and `ocrPrepass` (~1797). String emission sites: ~1138 (`… — paused while you search…`), ~1399 (cadence: `Indexed N files · M chunks`), ~1475 (end of pass, same text), ~1829 (`OCR done/total`). Cadence constants `PROGRESS_EVERY` / `PROGRESS_MAX_SILENCE_MS` at ~98-102.
- `filesCommitted++` happens at FOUR sites in `embedAndCommitFiles` (grep `filesCommitted++`): ~1039 (normal commit; the path is `p.fs.file.path`), ~1183 (OCR transient quarantine record, image; `file.path`), ~1249 (image zero-chunk record; `file.path`), ~1346 (record-only commit, note; `file.path`). Files skipped on error, and images waiting for OCR text (`filesWaitingOcr++` ~1195), are NEVER counted — so `done` can end below `total`. That is correct and expected (plan §Invariants).
- The orchestrator is constructed once in `src/main.ts` `onload` (~461) before `addSettingTab` (~470) and never replaced. Subscriptions on it are lifetime-safe.
- `src/settings-tab.ts` `startReindex()` (~559-582): sets `reindexTotal = collectIndexableFiles(...).length`, then parses `onProgress` messages with `msg.match(/Indexed\s+([\d,]+)\s+files/i)` into `reindexDone` and calls `paintProgress()` (~584), which paints `N / M notes · pct%`. It ignores the `OCR n/m` messages. There is NO settings-tab unit test today.
- `e2e/search.e2e.ts` ~36 also parses the string (`REINDEX_DONE_PATTERN`). It must keep working: DO NOT remove or change the string channel.
- Notes (md/.base/.canvas) and images are embedded in the SAME `embedAndCommitFiles` pass; images are classified by `isIndexableImagePath(path)` from `src/image-file.ts`. Images first go through `ocrPrepass` (desktop only, when `settings.indexImages` is on); its queue variable is `queue` and its counter is `done`.
- The catch-up drain (`src/catchup.ts` `drainCatchUp`, called from `src/main.ts` `runCatchUp` ~1857) calls `reindexDelta` WITHOUT `onProgress`. A subscribe API on the orchestrator (below) means its progress flows without touching `catchup.ts`.
- vitest runs in node (no jsdom); `obsidian` is stubbed by `src/test-stubs/obsidian.ts`. The tier-2 harness `src/test-harness/scenario.ts` exposes the orchestrator as public `s.orch` and boots with an optional fake OCR engine (`s.boot(settings, { indexDir, ocrEngine: fakeOcrEngine() })`, see `src/image-indexing.test.ts` ~40).

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
   // Small emitter: subscribe(listener) returns an unsubscribe fn; emit(e) calls every
   // listener inside try/catch (log via an injected `onListenerError` or console.error) so a
   // throwing UI listener can never break the index loop.
   export class IndexProgressEmitter { ... }
   // Pure label for the settings card (see 3): "80 / 90 notes" | "80 / 90 notes · 10 / 30 images" | "OCR 3 / 12 images".
   export function progressLabel(e: IndexProgressEvent): string;
   ```
   WHY comment at the top: two UI consumers (settings card, status bar) need per-type counts; the string channel stays for logs/toasts/e2e; `done` may end below `total` (skips / waiting OCR) so completion is signalled by the task context, never by `done === total`.
2. `SearchOrchestrator` gets `private readonly progress = new IndexProgressEmitter()` and a public `onIndexProgress(listener): () => void` delegating to it.
   - `embedAndCommitFiles`: compute up front `imagesTotal = files.filter(f => isIndexableImagePath(f.path)).length`, `notesTotal = files.length - imagesTotal`. Add a local closure `const recordCommit = (path: string) => { filesCommitted++; if (isIndexableImagePath(path)) imagesDone++; else notesDone++; };` and replace ALL FOUR `filesCommitted++` sites with it (grep must return zero bare `filesCommitted++` afterwards). WHY a closure: four sites, one rule — a missed site silently under-counts.
   - Add a local `emitProgress(paused: boolean)` closure that emits `{ phase:'embed', notes:{done:notesDone,total:notesTotal}, images:{done:imagesDone,total:imagesTotal}, paused }`. Call it (a) once at pass start (done 0, before the loop) so consumers learn the totals immediately, (b) at the ~1138 paused site with `paused:true`, (c) at the ~1399 cadence site, (d) at the ~1475 end-of-pass site.
   - `ocrPrepass`: next to the existing `OCR ${done}/${queue.length}` string (~1829), emit `{ phase:'ocr', notes:{done:0,total:0}, images:{done, total: queue.length}, paused:false }`.
3. `src/settings-tab.ts`:
   - Delete the regex. In `startReindex()`, subscribe via `this.plugin.onIndexProgress(...)` (add that one-line public passthrough on the plugin in `src/main.ts`; the orchestrator exists before the tab is registered, so it can simply delegate). Unsubscribe in BOTH the `.then` and `.catch` of `runFullReindex` AND in `hide()` (store the unsubscribe fn in a field, null it after calling).
   - KEEP the up-front `collectIndexableFiles(...).length` as the placeholder `reindexTotal` until the first event arrives: on a first run, model download can precede the first event by minutes and the bar must not read `0 / 0` meanwhile.
   - On an `'embed'` event: `reindexDone = notes.done + images.done`, `reindexTotal = notes.total + images.total`, label from `progressLabel(e)` + ` · pct%`. On an `'ocr'` event: paint `progressLabel(e)` (the OCR pre-pass has its own total; do not mix it into the embed pct).
   - Keep passing `onProgress` to `runFullReindex` only if something still needs it (nothing in the tab should after this change; remove the option from the call if unused, but keep the `runFullReindex` signature — the e2e uses it).
4. Tests (BDD GIVEN/WHEN/THEN, one assert each, colocated):
   - `src/index-progress.test.ts`: subscribe delivers; unsubscribe stops delivery; a throwing listener does not prevent a later listener from being called; `progressLabel` for each of the three shapes.
   - Orchestrator-level, in a new `src/index-progress-wiring.test.ts` using `Scenario` (read `src/test-harness/CLAUDE.md`; copy the boot pattern from `src/image-indexing.test.ts`): subscribe with `s.orch.onIndexProgress`, run `s.coldStart()`; assert (one test each) the FIRST `'embed'` event has `notes.done === 0` and `notes.total` = note count; the LAST `'embed'` event has `notes.done === notes.total`; with images enabled + fake OCR engine, the last `'embed'` event's `images.total` = image count; an `'ocr'` event with `images.total` = image count is emitted before the first `'embed'` event.
   - Settings tab: no test file exists and the class is Obsidian-coupled; the pure `progressLabel` test above is the coverage. Do not build a settings-tab test harness in this ticket.
5. `npm run typecheck`, `npm run test` green (redirect output to `.tmp/`). Do NOT run the e2e suites here.
6. Update `src/CLAUDE.md` (Orchestration layer line: mention `index-progress.ts`, one clause). Record with `change_log` at the end.

## Non-goals
- No status bar in this ticket (part 2 owns `src/status-bar.ts` and has its OWN strings; do not try to share `progressLabel` with it). No change to toast strings or the `onProgress` string channel.

## Resolution (done 2026-09-03)
Implemented as specified. Where things live:
- **`src/index-progress.ts`** (new, pure/Obsidian-free): `IndexProgressPhase`, `FileTypeProgress`, `IndexProgressEvent`, `IndexProgressListener`, `IndexProgressEmitter` (subscribe→unsubscribe; per-listener try/catch routed to an injected `onListenerError` defaulting to `console.error`), and `progressLabel(e)` producing the three shapes. Counts are `toLocaleString()`-grouped.
- **`src/search.ts`** `SearchOrchestrator`: `private readonly progress = new IndexProgressEmitter()` + public `onIndexProgress(listener)` delegating to it. In `embedAndCommitFiles`: up-front `imagesTotal`/`notesTotal` + running `imagesDone`/`notesDone`; a single `recordCommit(path)` closure replaces ALL FOUR `filesCommitted++` sites (grep confirms zero bare `filesCommitted++` remain except the one inside `recordCommit`). Typed events emitted at pass-start (done 0), the paused site (`paused:true`), the cadence site, and end-of-pass. `ocrPrepass` emits a `phase:'ocr'` event per image next to the `OCR n/m` string.
- **`src/main.ts`**: one-line `onIndexProgress` passthrough to the orchestrator.
- **`src/settings-tab.ts`**: regex deleted; `startReindex` subscribes via `this.plugin.onIndexProgress`, stores the unsub in `reindexProgressUnsub`, and tears it down in the run's `.then`/`.catch` AND in `hide()`. `onReindexProgress(e)` maps `'embed'`→`reindexDone/reindexTotal` + `progressLabel(e) · pct%`, `'ocr'`→`progressLabel(e)` only (never folded into the embed pct). Up-front `collectIndexableFiles(...).length` kept as the placeholder total (with an initial placeholder label) until the first event. `runFullReindex` call no longer passes `onProgress` (signature unchanged — e2e still uses it).
- **Tests**: `src/index-progress.test.ts` (emitter deliver/unsub/throwing-listener-isolation/onListenerError + the three label shapes) and `src/index-progress-wiring.test.ts` (Scenario: first embed `notes.done===0`, first embed `notes.total`=note count, last embed `done===total`, last embed `images.total`=image count with fake OCR, an `ocr` event with the image total precedes the first `embed`).

### Assumptions / deviations (non-interactive calls made)
- **Local emit closure named `emitTypedProgress`, not `emitProgress`** (the ticket suggested `emitProgress`). `search.ts` already has a private method `this.emitProgress(...)` for the NDJSON firehose; a same-named local closure in the same method is a POLS footgun. Distinct name, same behaviour.
- The initial placeholder progress label in `startReindex` is `"0 / <total> notes · 0%"` (total = full indexable count incl. images) — replaced by the first real event within the pass. Purely cosmetic pre-first-event text.

### Gates
- `npm run test`: 1583 passed / 19 skipped, green (`.tmp/fulltest.txt`).
- `npm run typecheck`: zero `src/` errors. The only failures are pre-existing e2e `@playwright/test` module-not-found errors — `@playwright/test` is not installed in this container; unrelated to this change.
- `change_log` entry recorded (id `blfgizcxvrqom8vzh6p5mdlyw`).

## Notes

**2026-09-03T23:43:52Z**

__REVIEW_AGAIN__: Fixed a real regression — reopening Settings mid-reindex froze the progress bar (subscription dropped in hide(), never re-established); renderReindexRow now resubscribes. Subscription-lifecycle change deserves a fresh pass.

**2026-09-03T23:46:20Z**

__READY_AS_IS__: no bugs found; only a DRY dedupe of the settings-tab pct formula, typecheck + full vitest green (1583 passed)
