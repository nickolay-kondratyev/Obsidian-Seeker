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

Origin ticket: nid_727bwz8g26vhaqb0921npefaj_e (interview complete, HUMAN aligned 2026-09-03).

## Problem
Nothing in the main Obsidian UI tells the user whether notes/images are indexed or how far indexing is. Today progress exists only as toasts and a settings-card progress bar that regex-parses a free-form `onProgress` string (`src/settings-tab.ts:567`); the e2e suite parses the same string (`e2e/search.e2e.ts:36`).

## Agreed behaviour (HUMAN decisions)
- **Busy (embedding)**: status-bar text `Seeker notes 80/90` and, when image indexing is on and the pass has images, ` · images 10/30`. File counts only (no chunk counts).
- **Busy (OCR pre-pass)**: `Seeker OCR 3/12`.
- **Loading model**: `Seeker loading model…`.
- **Idle and fully indexed**: a check icon only, hover tooltip `Seeker: index up to date`.
- **Idle but NOT fully indexed** (deferred cold embed, images waiting for OCR from a desktop, health degraded/recovering): a distinct "pending" icon (clock; alert for degraded) with a tooltip explaining why. The check mark must never lie.
- **Anti-flicker**: a busy/loading state is shown only after it has persisted for 1 s (`BUSY_SHOW_DELAY_MS = 1000`). Returning to idle applies immediately and cancels the timer. This replaces a bulk-vs-single split: a single-note edit finishes under 1 s and never paints; a bulk paste that takes seconds does.
- Desktop only (Obsidian has no status bar on mobile). Click opens Seeker settings.

## Architecture (AGENT decisions, veto passed)
1. `src/index-progress.ts` — structured `IndexProgressEvent { phase: 'ocr'|'embed'; notes: {done,total}; images: {done,total}; paused: boolean }` emitted by `SearchOrchestrator` via a subscribe API (`onIndexProgress(listener) => unsubscribe`), alongside (not replacing) the existing string `onProgress` channel, which stays for logs/toasts/e2e. Settings tab switches from regex to the event (DRY).
2. `src/status-bar.ts` — pure, DOM-free: a `StatusBarState` union → `renderStatusBar()` mapping, plus a `StatusBarController` that owns the 1 s debounce and talks to a tiny `StatusBarHost` interface. Unit-tested under node vitest (no jsdom in this repo).
3. `src/main.ts` — thin glue: `addStatusBarItem()`, host implementation over the element, `refreshStatusBar()` computing the state from existing signals (`TaskContextTracker` push/pop, `indexHealth`, `catchUpPending`, `dirtyQueue`, `orchestrator.ocrWaitingCount`, progress events).
4. e2e: one real-Obsidian assertion that the item reaches the complete state after the corpus reindex, plus busy text while it runs.

## Tickets (in dependency order)
1. Structured index-progress events + settings-tab consumer.
2. Status bar module + main.ts wiring + CSS.
3. Real-Obsidian e2e assertion + docs.

