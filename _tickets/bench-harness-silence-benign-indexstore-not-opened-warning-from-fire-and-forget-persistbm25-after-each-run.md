---
closed_iso: 2026-09-03T00:30:53Z
session_ids: [{"a": "claude", "type": "execution", "id": "7f6b0a29-aa3f-45de-88fd-ecd865624b7e"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_6ndc4i6wlutvwg8obu5m9prtp_e
title: "Bench harness: silence benign 'IndexStore not opened' warning from fire-and-forget persistBm25 after each run"
status: closed
deps: []
links: []
created_iso: 2026-09-03T00:22:42Z
status_updated_iso: 2026-09-03T00:30:53Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
parent: nid_mw6gkmuurjhiqva4rr6doenul_e
tags: [perf, bench]
---

Every `npm run bench` run logs on stderr:
  `[seek] BM25 persist failed (cold start will refit) Error: IndexStore not opened` from `SearchOrchestrator.persistBm25`.

Cause: `warmCaches()` in `src/search.ts` fires `void this.persistBm25(...)` immediately before clearing its private `warming` flag, so `drainCacheWarm()` in `bench/harness/page.ts` returns while the persist write is still in flight; `store.close()` then makes it fail. Harmless for the numbers (headline wall-clock is measured before) but noisy. Fix candidates: (a) in page.ts poll a short grace period / wait for the store to have no in-flight transactions before close, (b) give the bench a way to await persistBm25 without adding a production seam. Also `deleteDb` in page.ts already tolerates the resulting IndexedDB `blocked` event (fixed in nid_eiq9gtj7yeiic6cgztef2c0ki_e).


## Resolution (2026-09-03)

**Root cause, precisely:** `persistBm25` has two awaits — `store.getMeta()` then `store.putBm25()`. `warmCaches()` clears `warming` right after firing it, so the old poll-on-`warming` drain returned while `persistBm25` was still inside `getMeta()`; `store.close()` then made `putBm25`'s `requireDb()` throw `IndexStore not opened`.

**Fix (option b, no production seam):** new `bench/harness/drain-cache-warm.ts` — `CacheWarmDrainer`. Its constructor wraps `orch['persistBm25']` on the instance (private, reached by element access like the existing `warming` peek) to capture every promise it returns; `drain()` polls `warming` to false and then awaits those promises. `page.ts` constructs the drainer BEFORE `reindexAll()` (so the warm's call goes through the wrapper) and awaits `drain()` before the `finally` closes the store. The `deleteDb` `blocked` handler stays as a backstop; its comment was updated.

**Test:** `bench/harness/drain-cache-warm.test.ts` (runs in the normal `npm run test`, real orchestrator + IndexStore on fake-indexeddb via the tier-2 scenario harness). Non-obvious: fake-indexeddb settles faster than the 10 ms poll, which hides the race, so the test wraps `store.getMeta` with a 40 ms delay to recreate the real-browser gap. Verified red against the poll-only drain, green with the fix.

**Verified end-to-end:** `BENCH_FILES=3 node bench/harness/run.mjs` (wasm, in the dev container) — stderr contains neither the persist warning nor the `deleteDatabase blocked` line.
