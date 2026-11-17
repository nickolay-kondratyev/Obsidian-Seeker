---
id: nid_oa3w5abv27trliro95mqpc7h9_e
title: "Reopening a vault wipes its index: boot reconcile runs before the vault file list is loaded"
status: in_progress
deps: []
links: [nid_bn1mmy0av706371brezkpnxnh_e]
created_iso: 2026-11-17T18:03:09Z
status_updated_iso: 2026-11-17T18:03:56Z
type: bug
priority: 0
assignee: CC_WITH-nickolaykondratyev
tags: [boot-wipe]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker/.worktree/t-oa3w5abv
---

## Goal

Reopening a vault that was indexed minutes ago must NOT lose its index. Today the user often sees "Your vault isn't indexed yet" and has to run a full reindex after simply reopening a vault.

Root cause (verified from the user's live device log + code, 2026-11-17): plugin `onload` (`src/main.ts`) fires the boot reconcile IIFE immediately — `enforceIndexIdentity` → `reconcileSidecarIfChanged` → `reconcileOnLoad` → `SearchOrchestrator.computeDelta` (`src/search.ts`). Obsidian has NOT finished loading the vault's file list at that point, so `computeDelta` sees few/no live files and reports every stored path as `deleted`; `reindexDelta` then drops them from IndexedDB. Seconds later Obsidian fires a vault `create` event for every existing file (documented in `node_modules/obsidian/obsidian.d.ts` `Vault.on('create')`: "also called when the vault is first loaded for each existing file … register your event handler inside Workspace.onLayoutReady"), the `create` handler in `wireIncrementalIndexing` (`src/main.ts`) marks them all dirty, and the flush re-adds what it can from the sidecar; the rest is deferred to re-embed. When the sidecar can't restore the vault (see nid_5bp0gdi1w9d1svfcitafvnduh_e), the index stays empty → "not indexed" copy in `src/search-modal.ts` (`renderNoIndex`).

Log evidence (per-device NDJSON `delta-apply` entries): at every boot, `removed: <all chunks>, added: 0` within ~1–4 s of `init`, followed later by `added: <n>` from sidecar hydrate. E.g. one vault: 17:54:07 removed 2565 → searches at 17:54:07/09 returned nothing → 17:54:19 hydrated only 2188.

## Done criteria

- No boot step that diffs or mutates the index against the live vault file list runs before `app.workspace.onLayoutReady` fires (identity gate, sidecar reconcile, `reconcileOnLoad`, and the periodic reconcile's first effective run).
- The startup flood of vault `create` events does not enqueue files: the `create` handler is registered (or becomes effective) only after layout ready, per the Obsidian doc. `modify`/`delete`/`rename` behavior is unchanged.
- A unit/scenario test reproduces the bug on the current code (FAILS before the fix): plugin boots with a populated store and a vault whose file list is empty until layout-ready fires → after layout ready, the store still holds every chunk and no `delete` reached the store. Same test passes after the fix.
- A test proves files changed/added/deleted while Obsidian was closed are still caught up after layout ready (the existing mtime + content-hash diff in `computeDelta`), i.e. the fix delays the reconcile, it does not skip it.
- `npm run typecheck` and `npm run test` green; `npm run test:e2e:obsidian` green (the merge step runs it).

## Context

- `src/main.ts`: `onload` (store open ~line 376, boot IIFE ~lines 486–545), `enforceIndexIdentity`, `reconcileOnLoad`, `periodicReconcile`, `wireIncrementalIndexing` (vault `create`/`delete`/`rename` handlers).
- `src/search.ts`: `computeDelta` (deleted = stored paths not in `indexableFiles()`), `reindexDelta`, `reconcileSidecarIfChanged`, `hydrateSidecar`, `reconcileIdentityInPlace` (also calls `computeDelta`).
- `src/test-stubs/obsidian.ts` (vitest `obsidian` stub; read `src/test-stubs/CLAUDE.md`) has no `workspace.onLayoutReady`/`layoutReady` — add what the test needs. `src/test-harness/` (see its CLAUDE.md) is the tier-2 scenario harness.
- The real-Obsidian e2e harness (`docs/e2e-obsidian.md`) enables the plugin only AFTER layout ready, so it will not reproduce this race; don't rely on e2e for the regression — unit/scenario level is the gate.
- The user asked for "store timestamps and only reindex new/changed files, remove deleted ones". That mechanism already exists (`FileRecord` mtime + contentHash, `classifyFileDelta` in `src/index-store.ts`); the bug is only WHEN it runs. Do not build a second mechanism.
- Related: nid_bn1mmy0av706371brezkpnxnh_e (coverage gate on `rebuildFromSidecar`) touches the same boot path; don't implement it here.

## Constraints

- Use Obsidian's documented `app.workspace.onLayoutReady` (runs immediately if already ready, so plugin re-enable mid-session still works). No timers/sleeps to "wait for the vault".
- Keep the boot work off the load path (fire-and-forget) as today; keep the existing sequencing (identity gate → sidecar reconcile → reconcileOnLoad).
- Popout-window convention from root `CLAUDE.md` applies (`window.setTimeout`, never bare globals).

## Non-goals

- Fixing the shared-plugins-folder sidecar collision (nid_5bp0gdi1w9d1svfcitafvnduh_e).
- A heuristic "refuse mass deletion" guard in `computeDelta` — layout-ready gating is the root fix; add a guard only if the human asks.
- Changing reindex/embedding logic, sidecar format, or DB/version constants.
