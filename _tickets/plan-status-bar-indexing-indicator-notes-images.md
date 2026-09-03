---
closed_iso: 2026-09-03T23:18:06Z
id: nid_07petn152dbm3y13beujob1z3_e
title: "PLAN: status-bar indexing indicator (notes + images)"
status: closed
deps: []
links: []
created_iso: 2026-09-03T23:16:45Z
status_updated_iso: 2026-09-03T23:18:06Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [ui, plan]
---

# PLAN (high-level): status-bar indexing indicator for notes + images

Origin ticket: nid_727bwz8g26vhaqb0921npefaj_e (interview complete, HUMAN aligned 2026-09-03). Reviewed for logical soundness 2026-09-03 (added the `no-index` state, tightened the `deferred` definition, made the choke points mandatory).

## Problem
Nothing in the main Obsidian UI tells the user whether notes/images are indexed or how far indexing is. Today progress exists only as toasts and a settings-card progress bar that regex-parses a free-form `onProgress` string (`src/settings-tab.ts` ~568); the e2e suite parses the same string (`e2e/search.e2e.ts` ~36).

## Agreed behaviour (HUMAN decisions)
- **Busy (embedding)**: status-bar text `Seeker notes 80/90` and, when the pass contains images, ` · images 10/30`. File counts only (no chunk counts).
- **Busy (OCR pre-pass)**: `Seeker OCR 3/12`.
- **Loading model**: `Seeker loading model…`.
- **Idle and fully indexed**: a check icon only, hover tooltip `Seeker: index up to date`.
- **Idle but NOT fully indexed**: a distinct "pending" icon (clock; alert-triangle for degraded) with a tooltip explaining why. The check mark must never lie. Pending reasons, most specific first:
  1. `degraded` — index needs a reindex (health `degraded`).
  2. `recovering` — health `recovering`.
  3. `no-index` — the store holds zero chunks (fresh install / evicted index). Same probe the modal's onboarding panel uses (`SearchOrchestrator.indexedChunkCount()`).
  4. `waiting-ocr` — N images are waiting for OCR text from a desktop (`orchestrator.ocrWaitingCount`).
  5. `deferred` — an embed was deferred to a safe window (`catchUpPending || driftRecoveryPending`). NOT `dirtyQueue`/`deletedQueue`: those fill on every keystroke and drain by a scheduled flush within seconds; counting them would flip the icon to a clock on every edit.
- **Anti-flicker**: a busy/loading state is shown only after it has persisted for 1 s (`BUSY_SHOW_DELAY_MS = 1000`). Returning to idle applies immediately and cancels the timer. This replaces a bulk-vs-single split: a single-note edit finishes under 1 s and never paints; a bulk paste that takes seconds does.
- Desktop only (Obsidian has no status bar on mobile). Click opens Seeker settings.

## Invariants (read before implementing any part)
- **Completion is signalled by the task context, never by counts.** In a pass, `done` can legitimately end below `total` (files skipped on error, images waiting for OCR text, budget-deferred bursts). Busy ends when the `'indexing'`/`'catchup'` task context pops; whether the index is *current* is then decided by the pending reasons above.
- **The string `onProgress` channel stays untouched.** Logs, toasts and the e2e suite (`e2e/search.e2e.ts` `REINDEX_DONE_PATTERN`) depend on it. The structured event is additive.
- **One choke point per signal.** Task-context changes go through the `pushTaskContext`/`popTaskContext` wrappers in `src/main.ts`; health changes go through a new `setIndexHealth()` setter (there are seven assignment sites today). Every choke point calls `refreshStatusBar()`.

## Architecture (AGENT decisions, veto passed)
1. `src/index-progress.ts` — structured `IndexProgressEvent { phase: 'ocr'|'embed'; notes: {done,total}; images: {done,total}; paused: boolean }` emitted by `SearchOrchestrator` via a subscribe API (`onIndexProgress(listener) => unsubscribe`), alongside (not replacing) the string `onProgress` channel. The settings tab switches from regex to the event (DRY). The orchestrator is constructed exactly once in `onload` (`src/main.ts` ~461) and never replaced, so subscriptions on it are lifetime-safe.
2. `src/status-bar.ts` — pure, DOM-free: a `StatusBarState` union → `renderStatusBar()` mapping (the single copy source for all strings/icons), plus a `StatusBarController` that owns the 1 s debounce and talks to a tiny `StatusBarHost` interface. Unit-tested under node vitest (no jsdom in this repo).
3. `src/main.ts` — thin glue: `addStatusBarItem()`, host implementation over the element, `refreshStatusBar()` computing the state from existing signals (task context, `indexHealth` via the setter, `indexEmpty` probe, `orchestrator.ocrWaitingCount`, `catchUpPending`/`driftRecoveryPending`, last progress event). A tiny shared `openSeekerSettings(app)` helper replaces the inline snippet in `src/search-modal.ts` ~826 and is reused by the click handler.
4. e2e: real-Obsidian assertions that a fresh vault shows `pending`/`no-index`, the item shows busy text during the corpus reindex, and reaches `complete` afterwards.

## Tickets (in dependency order)
1. nid_z8zzhahzmj7ioue0uc6wn4v3h_e — structured index-progress events + settings-tab consumer.
2. nid_5di3g372edklzeuxic2karflj_e — status bar module + main.ts wiring + CSS.
3. nid_rpphqlnvtxqlesxfnacwstgez_e — real-Obsidian e2e assertions + docs.
