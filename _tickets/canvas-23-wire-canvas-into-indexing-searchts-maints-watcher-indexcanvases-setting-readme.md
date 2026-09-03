---
closed_iso: 2026-09-03T18:13:29Z
session_ids: [{"a": "claude", "type": "execution", "id": "7cbd4b3f-d509-4dd7-9d18-12ccbe26c7a2"}, {"a": "claude", "type": "review", "id": "6351cd5e-3a9a-4d8b-b7b4-dc0a800e2b44"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-1
id: nid_uc1ko4l0thzf7slennqeac9xb_e
title: "Canvas 2/3: wire .canvas into indexing (search.ts, main.ts watcher, indexCanvases setting, README)"
status: closed
deps: [nid_13s1ij8gtxmxfy9my7p9ujy98_e]
links: []
created_iso: 2026-09-03T17:16:23Z
status_updated_iso: 2026-09-03T18:13:29Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
parent: nid_5w0bsx5qhm7xfssdkim4qshxv_e
tags: [canvas]
---

Part 2 of 3 of the canvas search epic. Plan of record: docs/canvas-search-plan.md (§3c touchpoints). Depends on part 1 (extractor + chunkCanvas).

Deliver, mirroring every `.base` / `indexBases` touchpoint:
- src/types.ts settings: `indexCanvases: boolean`, default true; settings-migrate test for the default.
- src/search.ts: `indexableFiles()` adds `extension === 'canvas'` gated on the setting; `chunksFor()` routes `.canvas` → extractCanvasDocs + chunkCanvas (the ONLY place the split lives — reChunkLive/collectLiveIds/dedupViaSidecar/carryOverHydrate all go through it).
- src/main.ts `isIndexableFile`: same gate (watcher create/modify/rename/delete).
- src/settings-tab.ts: toggle next to the Bases toggle + reindex total count includes canvases.
- src/test-stubs/obsidian.ts: extend the `extension` stub note for canvas.
- README.md: one line under indexed file types.
- Tests: chunksFor route, isIndexableFile gate, settings default. Verify the drag/resize case: rewriting a canvas with only x/y changes re-derives identical chunk ids → no re-embed (classifyFileDelta → dirty → chunk diff → nothing to embed).


## Notes

**2026-09-03T17:43:51Z**

Post-rebase review addenda (docs/canvas-search-plan.md §6, 2026-09-03):
- R5 (needs human, Q8 in .out/current_decision.md): search-modal.ts noteTitle() strips only `.md`, so canvas results would list as "Roadmap.canvas". Strip `.canvas` in the result-list title; whether to also strip `.base` (wholesale pattern change) is the human's call.
- R7: settings toggle copy says "next catch-up sweep" (computeDelta handles add/remove), not "next full reindex".
- R7: the drag/resize test asserts zero adds/removed in the burst change-set (only the file record mtime moves), not merely "no embed".

**2026-09-03T17:52:52Z**

DECIDED Q8 (2026-09-03): option C — result-list title stays "Roadmap.canvas" (no change to noteTitle()). The extension is deliberate signal that the hit is a canvas. Tags decide/need-human cleared.

## Resolution (2026-09-03)

Delivered in commit `4c1f81b` (branch `nid_uc1ko4l0thzf7slennqeac9xb_e_canvas-2-3-wire-canvas-into-indexing-sea`). typecheck / build / full vitest (1335 passed) green.

**What was built**
- `src/indexable-file.ts` (NEW, replaces the private `isIndexableFile` in `src/main.ts`): the ONE md / `.base` / `.canvas` gate. `isIndexableFile(f, gate)` for the watcher; `collectIndexableFiles(vault, gate)` for collection (md first via `getMarkdownFiles`, then gated extras from `getFiles`; returns the md array itself when both toggles are off). Callers: `src/search.ts` `indexableFiles()`, `src/main.ts` watcher (create/modify/rename/delete), `src/settings-tab.ts` reindex total. Deviation from the ticket's literal "same gate in main.ts": the gate was DRY'd into one module rather than duplicated a third time — it takes the whole settings object (`Pick<SeekerSettings,'indexBases'|'indexCanvases'>`) so a future extension adds one `case`.
- `src/search.ts` `chunksFor()`: `.canvas` → `chunkCanvas(extractCanvasDocs(content, path, this.chunker.minChunkChars), …)`. The short/long card threshold is the chunker's own `minChunkChars` (plan §6 R3). Still the ONLY place the split lives.
- `src/types.ts`: `indexCanvases: boolean`, default `true`, no migration clause (default-only field; old data.json falls through to ON in onload). No settingsRev bump.
- `src/settings-tab.ts`: "Index Canvas files" toggle right under the Bases toggle; copy says "next catch-up sweep" (R7). The Bases toggle copy ("next full reindex") was left as-is — out of scope, but it is the same mechanism and could be aligned.
- `src/test-stubs/obsidian.ts` + `src/test-harness/fake-vault.ts` comments point at `indexable-file.ts`. `README.md` Features gains the indexed-file-types line. `src/CLAUDE.md` Indexing layer names `indexable-file.ts`.

**Tests**
- `src/indexable-file.test.ts`: gate per extension × toggle; collection order; no `getFiles` walk when both toggles are off.
- `src/settings-migrate.test.ts`: `indexCanvases` default ON and untouched by `migrateSettings`.
- `src/canvas-indexing.test.ts` (tier-2 scenario, real orchestrator + store): `chunksFor` route (map chunk + long-card chunk with `canvas_node_id`), group label in `heading_path`, `indexCanvases: false` excludes the canvas, and the drag/resize case: rewriting the canvas with only x/width changed at a new mtime → `embedBatch` never called, chunk-id set identical, the ONE `delta-apply` entry has `added: 0, removed: 0`, and the file record's `mtimeMs` advanced.
- Harness change enabling that: `src/test-harness/scenario.ts` `boot(settingsOverride?)` and `logEntries` (captures every `logger.append`).

**Not in this ticket (part 3)**: `search-modal.ts` `.canvas` open branch + node focus; result-list title stays "Roadmap.canvas" per Q8.

**2026-09-03T18:15:04Z**

__READY_AS_IS__: review found no bugs; gate/chunksFor/watcher/settings wiring is consistent, malformed canvas JSON is caught, computeDelta drops canvases on toggle-off as the copy claims; typecheck + 1335 tests green, nothing changed.
