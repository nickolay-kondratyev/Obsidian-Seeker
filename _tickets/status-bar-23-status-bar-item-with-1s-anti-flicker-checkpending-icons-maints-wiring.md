---
profile: higher
id: nid_5di3g372edklzeuxic2karflj_e
title: "Status bar 2/3: status-bar item with 1s anti-flicker, check/pending icons, main.ts wiring"
status: open
deps: [nid_z8zzhahzmj7ioue0uc6wn4v3h_e]
links: []
created_iso: 2026-09-03T23:18:06Z
status_updated_iso: 2026-09-03T23:18:06Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ui]
---

Part 2 of 3 of plan ticket nid_07petn152dbm3y13beujob1z3_e (read it first, especially §Invariants; requires part 1's `src/index-progress.ts` and `SearchOrchestrator.onIndexProgress`). Goal: the bottom-right Obsidian status-bar item that shows indexing progress for notes and images while busy, a check icon when fully indexed, and a pending icon when idle-but-not-current. Desktop only.

## Agreed behaviour (HUMAN-aligned, do not deviate)
- Busy, embed phase: text `Seeker notes 80/90`; append ` · images 10/30` only when the event's `images.total > 0`. If `paused`, append ` (paused)` and tooltip `Seeker: indexing paused while you search`.
- Busy, OCR phase: `Seeker OCR 3/12`.
- Busy but no event received yet: `Seeker indexing…`.
- Loading model: `Seeker loading model…`.
- Idle + fully indexed: NO text, icon `check`, tooltip `Seeker: index up to date`.
- Idle + pending (never show the check mark here). Reasons, in the priority `refreshStatusBar` evaluates them:
  1. `degraded`: icon `alert-triangle`, tooltip `Seeker: index needs a reindex — click to open settings`.
  2. `recovering`: icon `clock`, tooltip `Seeker: index is recovering…`.
  3. `no-index` (store holds zero chunks — fresh install or evicted index): icon `clock`, tooltip `Seeker: vault not indexed yet — search once to build the index, or click to open settings`.
  4. `waiting-ocr` (N images waiting for OCR text from a desktop): icon `clock`, tooltip `Seeker: N images waiting for OCR text` (singular/plural).
  5. `deferred` (`catchUpPending || driftRecoveryPending`): icon `clock`, tooltip `Seeker: some notes are waiting to be indexed — they index on your next search`.
- Anti-flicker: `BUSY_SHOW_DELAY_MS = 1000`. A transition INTO `busy` or `loading-model` paints only if the state is still busy/loading after the delay (state updates that arrive meanwhile replace the pending render, they do NOT restart the timer). A transition to any idle state (`complete`/`pending`) paints immediately and cancels the timer. Idle→idle transitions paint immediately. WHY: a single-note re-embed finishes in well under 1 s and must not flash `notes 0/1` on every edit; a bulk paste that takes seconds should show.
- Click anywhere on the item opens Seeker settings.

## Design
1. New `src/status-bar.ts` (pure, DOM-free, Obsidian-free; vitest is node-only, no jsdom):
   ```ts
   import type { IndexProgressEvent } from './index-progress';
   export type PendingReason = 'degraded' | 'recovering' | 'no-index' | 'waiting-ocr' | 'deferred';
   export type StatusBarState =
       | { kind: 'complete' }
       | { kind: 'pending'; reason: PendingReason; imagesWaiting: number }
       | { kind: 'loading-model' }
       | { kind: 'busy'; progress: IndexProgressEvent | null };
   export type StatusBarIcon = 'check' | 'clock' | 'alert-triangle' | null;
   export interface StatusBarRender {
       text: string; icon: StatusBarIcon; tooltip: string;
       state: StatusBarState['kind'];          // → data-state (e2e hook)
       reason: PendingReason | null;           // → data-reason (e2e hook), null unless pending
   }
   export function renderStatusBar(state: StatusBarState): StatusBarRender;   // the ONE copy source (all strings above live here as named constants)
   export interface StatusBarHost { apply(r: StatusBarRender): void }           // implemented in main.ts over the HTMLElement
   export interface StatusBarScheduler { set(fn: () => void, ms: number): number; clear(id: number): void } // window.setTimeout/clearTimeout in prod (popout convention: window.*, never bare globals); fake in tests
   export const BUSY_SHOW_DELAY_MS = 1000;
   export class StatusBarController { constructor(host: StatusBarHost, scheduler: StatusBarScheduler); setState(s: StatusBarState): void; dispose(): void }
   ```
   The controller owns the debounce described above and nothing else. `renderStatusBar` is a pure function of its input.
2. New `src/open-settings.ts`: `export function openSeekerSettings(app: App): void` — move the inline `app.setting.open(); app.setting.openTabById('seeker')` snippet (with its structural cast) out of `src/search-modal.ts` ~826 and call the helper from there AND from the status-bar click handler. WHY: the undocumented `app.setting` cast must live in one place.
3. `src/main.ts` glue (keep it thin; no logic that belongs in `status-bar.ts`):
   - Fields: `private statusBar: StatusBarController | null = null;`, `private lastIndexProgress: IndexProgressEvent | null = null;`, `private indexEmpty = false;`.
   - In `onload`, desktop only (`Platform.isMobile` → leave `statusBar` null, no item): `const el = this.addStatusBarItem(); el.addClass('seeker-statusbar');`. Host `apply(r)`: `el.empty()`; if `r.icon` create an inner `span.seeker-statusbar-icon` and `setIcon(span, r.icon)`; if `r.text` append a text span; `el.setAttr('aria-label', r.tooltip)` + `el.setAttr('data-tooltip-position', 'top')` (Obsidian's native tooltip for status-bar items); `el.setAttr('data-state', r.state)`; `el.setAttr('data-reason', r.reason ?? '')`. Click handler via `this.registerDomEvent(el, 'click', () => openSeekerSettings(this.app))`. Scheduler = `{ set: (fn, ms) => window.setTimeout(fn, ms), clear: id => window.clearTimeout(id) }`.
   - `private refreshStatusBar(): void` — return immediately when `this.statusBar` is null (mobile, or called from a push/pop that runs during `onload` before the item exists). Otherwise compute `StatusBarState` from EXISTING signals in this priority and call `setState`:
     1. `currentTaskContext === 'model-load'` → `loading-model`. (Note: `runFullReindex` pushes `'indexing'` and THEN `ensureModelLoaded` pushes `'model-load'` on top, so top-of-stack is correct here.)
     2. `=== 'indexing' || === 'catchup'` → `busy` with `lastIndexProgress`.
     3. `indexHealth === 'degraded'` → pending `degraded`; `'recovering'` → pending `recovering`.
     4. `indexEmpty` → pending `no-index`.
     5. `orchestrator.ocrWaitingCount > 0` → pending `waiting-ocr` with that count.
     6. `catchUpPending || driftRecoveryPending` → pending `deferred`. Do NOT include `dirtyQueue`/`deletedQueue` (plan §Agreed behaviour explains why).
     7. else `complete`.
     `'search'`, `'bm25-warm'`, `'reconcile'` contexts are NOT busy.
   - Clear `lastIndexProgress` when the computed state is not `busy` (so the next busy phase starts at `Seeker indexing…`, not a stale count).
   - `private setIndexHealth(v: 'healthy' | 'recovering' | 'degraded'): void { this.indexHealth = v; this.refreshStatusBar(); }` and replace EVERY direct assignment — there are SEVEN today (~1188, ~1212, ~1226, ~1235, ~1275, ~1774, ~1782); after the change `grep -n "this.indexHealth = " src/main.ts` must show only the setter body.
   - `private async refreshIndexEmpty(): Promise<void>`: `this.indexEmpty = ((await this.orchestrator.indexedChunkCount()) ?? 0) === 0; this.refreshStatusBar();` (`indexedChunkCount` returns null on a store error → treat as not-empty so a transient IDB error does not show "not indexed"). Same probe the modal's onboarding uses (`src/search-modal.ts` `checkIndexState`).
   - Call `refreshStatusBar()` from: the `pushTaskContext` / `popTaskContext` wrappers (~194-199, the single choke point for phase changes; `catchUpPending` and `ocrWaitingCount` are always updated BEFORE the corresponding pop, so pop covers them); the progress subscription (`this.orchestrator.onIndexProgress(e => { this.lastIndexProgress = e; this.refreshStatusBar(); })`, subscribed right after the orchestrator is constructed ~461; keep the unsubscribe and call it in `onunload`); the two `driftRecoveryPending =` assignments (~1910, ~1984); and `setIndexHealth`. Call `refreshIndexEmpty()` (fire-and-forget with `void`) at the end of `onload` and inside `popTaskContext` when `c === 'indexing' || c === 'catchup'` (an IDB count is cheap; the modal runs it on every open).
   - `onunload`: `this.statusBar?.dispose()`.
4. `styles.css`: `.seeker-statusbar` — inline-flex, icon span vertically centred, small gap between icon and text; theme variables only (see the existing `.seeker-status-card` block ~line 1000 for conventions). No colour on the check; `var(--text-warning)` on the alert icon via `.seeker-statusbar[data-reason="degraded"] .seeker-statusbar-icon`.
5. Tests, BDD GIVEN/WHEN/THEN, one assert each:
   - `src/status-bar.test.ts` for `renderStatusBar`: every state/reason → exact text/icon/tooltip/state/reason; images segment present only when `images.total > 0`; paused suffix + tooltip; `waiting-ocr` singular vs plural; busy with `progress: null`.
   - `StatusBarController` with a fake scheduler (manual `fire()`): busy is not applied before the delay; busy applied after the delay; idle within the delay cancels and never paints busy; idle applies immediately; a progress update during the delay does not restart the timer (the render applied at fire time is the LATEST one); idle→idle applies immediately; `dispose` clears a pending timer.
   - `src/open-settings.test.ts`: the helper calls `open()` then `openTabById('seeker')` on a fake app (one assert each).
6. `npm run typecheck`, `npm run test`, `npm run build` green (redirect output to `.tmp/`). Manual check is NOT required here; part 3 adds the real-Obsidian proof.
7. Update `src/CLAUDE.md` (UI layer: add `status-bar.ts` + `open-settings.ts`, one clause each), `README.md` (one short paragraph under the features/user docs: what the status-bar item shows, including the pending icon meaning). Record with `change_log`.

## Non-goals
- No mobile fallback; no chunk counts; no new settings toggle. Empty vault with zero indexable files also shows `no-index` (matches the modal's onboarding; 80/20).
