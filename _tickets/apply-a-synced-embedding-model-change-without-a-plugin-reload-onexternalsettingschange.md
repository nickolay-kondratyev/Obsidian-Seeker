---
id: nid_hsgc2h9mt5yv0ib951qedlllh_e
title: "Apply a synced embedding-model change without a plugin reload (onExternalSettingsChange)"
status: open
deps: [nid_1zqy3m0wb155p2hidgz4z1pka_e]
links: []
created_iso: 2026-09-03T20:37:30Z
status_updated_iso: 2026-09-03T20:37:30Z
type: feature
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [model, follow-up]
---

Follow-up to the plan _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md (nid_uf0gnfjac87y3qls9mymlq5hj_e).

PROBLEM: SeekerSettings.modelOverride is synced via data.json so every device follows the same model, but src/main.ts reads data.json only in onload (loadData + migrateSettings, ~L316). There is no Obsidian `Plugin.onExternalSettingsChange` handler (obsidian.d.ts declares it). So after device A switches models, device B keeps embedding with the OLD model under the old identity until its plugin is reloaded; its sidecar stays old-identity (refused by A; no corruption) and convergence is delayed until B restarts.

GOAL: implement `onExternalSettingsChange()` in src/main.ts: re-read + migrate data.json, and if `modelOverride` (compare by activeModelSpec(settings).key + dim + revision) changed: mutate this.settings IN PLACE (the orchestrator shares the reference), embedder.teardown(), reset modelDriftWarned, and re-run the boot identity gate (enforceIndexIdentity) so the peer hydrates from the switching device sidecar / shows the stale banner immediately. Other synced settings changing externally is a separate concern — keep this ticket to the model key (or apply all fields if trivially safe; document the choice).

CONSTRAINTS: never bulk-embed on mobile (existing rule); do not stack on a running reindex (orchestrator.isWriting / isIndexBusy). Test what is pure (a `settingsModelChanged(prev, next)` predicate) in vitest.

DEPENDS on the model tickets 1/6..6/6 being merged (see the plan ticket notes for ids).

