---
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_6ndc4i6wlutvwg8obu5m9prtp_e
title: "Bench harness: silence benign 'IndexStore not opened' warning from fire-and-forget persistBm25 after each run"
status: in_progress
deps: []
links: []
created_iso: 2026-09-03T00:22:42Z
status_updated_iso: 2026-09-03T00:28:26Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
parent: nid_mw6gkmuurjhiqva4rr6doenul_e
tags: [perf, bench]
---

Every `npm run bench` run logs on stderr:
  `[seek] BM25 persist failed (cold start will refit) Error: IndexStore not opened` from `SearchOrchestrator.persistBm25`.

Cause: `warmCaches()` in `src/search.ts` fires `void this.persistBm25(...)` immediately before clearing its private `warming` flag, so `drainCacheWarm()` in `bench/harness/page.ts` returns while the persist write is still in flight; `store.close()` then makes it fail. Harmless for the numbers (headline wall-clock is measured before) but noisy. Fix candidates: (a) in page.ts poll a short grace period / wait for the store to have no in-flight transactions before close, (b) give the bench a way to await persistBm25 without adding a production seam. Also `deleteDb` in page.ts already tolerates the resulting IndexedDB `blocked` event (fixed in nid_eiq9gtj7yeiic6cgztef2c0ki_e).

