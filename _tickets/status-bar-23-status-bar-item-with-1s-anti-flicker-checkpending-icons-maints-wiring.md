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

Part 2 of 3 of plan ticket nid_07petn152dbm3y13beujob1z3_e (read it first; requires part 1's `src/index-progress.ts` and `SearchOrchestrator.onIndexProgress`). Goal: the bottom-right Obsidian status-bar item that shows indexing progress for notes and images while busy, a check icon when fully indexed, and a pending icon when idle-but-not-current. Desktop only.

## Agreed behaviour (HUMAN-aligned, do not deviate)
- Busy, embed phase: text `Seeker notes 80/90`; append ` · images 10/30` only when the event's `images.total > 0`. If `paused`, append ` (paused)` and tooltip `Seeker: indexing paused while you search`.
- Busy, OCR phase: `Seeker OCR 3/12`.
- Busy but no event received yet: `Seeker indexing…`.
- Loading model: `Seeker loading model…`.
- Idle + fully indexed: NO text, icon `check`, tooltip `Seeker: index up to date`.
- Idle + pending (never show the check mark here):
  - reason `deferred` (dirty notes queued / catch-up pending / drift recovery pending): icon `clock`, tooltip `Seeker: some notes are waiting to be indexed — they index on your next search`.
  - reason `waiting-ocr` (N images waiting for OCR text from a desktop): icon `clock`, tooltip `Seeker: N images waiting for OCR text` (singular/plural).
  - reason `recovering`: icon `clock`, tooltip `Seeker: index is recovering…`.
  - reason `degraded`: icon `alert-triangle`, tooltip `Seeker: index needs a reindex — click to open settings`.
- Anti-flicker: `BUSY_SHOW_DELAY_MS = 1000`. A transition INTO `busy` or `loading-model` paints only if the state is still busy/loading after the delay (counter updates that arrive meanwhile update the pending render, not the timer). A transition to any idle state paints immediately and cancels the timer. WHY: a single-note re-embed finishes in well under 1 s and must not flash `notes 0/1` on every edit; a bulk paste that takes seconds should show.
- Click anywhere on the item opens Seeker settings (same call as `src/search-modal.ts` ~826: `app.setting.open(); app.setting.openTabById('seeker')`).

## Design
1. New `src/status-bar.ts` (pure, DOM-free, Obsidian-free; vitest is node-only, no jsdom):
   ```ts
   import type { IndexProgressEvent } from './index-progress';
   export type PendingReason = 'deferred' | 'waiting-ocr' | 'recovering' | 'degraded';
   export type StatusBarState =
       | { kind: 'complete' }
       | { kind: 'pending'; reason: PendingReason; imagesWaiting: number }
       | { kind: 'loading-model' }
       | { kind: 'busy'; progress: IndexProgressEvent | null };
   export type StatusBarIcon = 'check' | 'clock' | 'alert-triangle' | null;
   export interface StatusBarRender { text: string; icon: StatusBarIcon; tooltip: string; state: StatusBarState['kind'] }
   export function renderStatusBar(state: StatusBarState): StatusBarRender;   // the ONE copy source (all strings above live here as named constants)
   export interface StatusBarHost { apply(r: StatusBarRender): void }           // implemented in main.ts over the HTMLElement
   export interface StatusBarScheduler { set(fn: () => void, ms: number): number; clear(id: number): void } // window.setTimeout/clearTimeout in prod (popout convention: window.*, never bare globals); fake in tests
   export const BUSY_SHOW_DELAY_MS = 1000;
   export class StatusBarController { constructor(host, scheduler); setState(s: StatusBarState): void; dispose(): void }
   ```
   The controller owns the debounce described above and nothing else.
2. `src/main.ts` glue (keep it thin; no logic that belongs in `status-bar.ts`):
   - In `onload`, desktop only (`Platform.isMobile` → skip entirely, no item): `const el = this.addStatusBarItem(); el.addClass('seeker-statusbar');` Host `apply()` sets: `el.setText(text)`; an inner icon span rendered with `setIcon(span, icon)` (cleared when null); `el.setAttr('aria-label', tooltip)` + `el.setAttr('data-tooltip-position','top')` (Obsidian's native tooltip mechanism for status-bar items); `el.setAttr('data-state', state)` (used by the part-3 e2e). Click handler via `this.registerDomEvent(el, 'click', ...)`.
   - `private refreshStatusBar()` computes `StatusBarState` from EXISTING signals, in this priority: `currentTaskContext === 'model-load'` → loading-model; `=== 'indexing' || 'catchup'` → busy with the last progress event (cache it in a field; clear it when leaving busy); else `indexHealthState === 'degraded'` → pending degraded; `'recovering'` → pending recovering; `orchestrator.ocrWaitingCount > 0` → pending waiting-ocr; `catchUpPending || driftRecoveryPending || dirtyQueue.size > 0 || deletedQueue.size > 0` → pending deferred; else complete. (`'search'`, `'bm25-warm'`, `'reconcile'` contexts are NOT busy.)
   - Call `refreshStatusBar()` from the `pushTaskContext` / `popTaskContext` wrappers (~line 194-199; the single choke point for phase changes), from the progress subscription (`orchestrator.onIndexProgress`, subscribed once the orchestrator exists), after `flushDirty` / `runCatchUp` complete, wherever `indexHealth` is assigned (~1188, 1212, 1226, 1235, 1275 — consider a tiny `setIndexHealth()` setter to avoid five call sites), and at the end of `onload`. Dispose the controller in `onunload`.
3. `styles.css`: `.seeker-statusbar` — icon span vertically centred, small gap between icon and text; theme variables only (see the existing `.seeker-status-card` block ~line 1000 for conventions). No colour on the check; use `var(--text-warning)` on the alert icon.
4. Tests, BDD one-assert-each:
   - `src/status-bar.test.ts` for `renderStatusBar`: every state/reason → exact text/icon/tooltip; images segment present only when `images.total > 0`; paused suffix.
   - `StatusBarController` with a fake scheduler: busy applied only after 1000 ms; idle within the delay cancels and never paints busy; idle applies immediately; progress updates during the delay do not restart the timer; `dispose` clears a pending timer.
5. `npm run typecheck`, `npm run test`, `npm run build` green. Manual check is NOT required here; part 3 adds the real-Obsidian proof.
6. Update `src/CLAUDE.md` (UI layer: add `status-bar.ts`, one clause), `README.md` (one short paragraph under the features/user docs: what the status-bar item shows). Record with `change_log`.

## Non-goals
- No mobile fallback; no chunk counts; no new settings toggle.

