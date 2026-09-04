---
id: nid_45vpzmg10gvd7vr84zpddit2r_e
title: "Existing custom embedding-model overrides are stranded with model selection hidden"
status: open
deps: []
links: [nid_u4z668hton69x0tdemih2kjwh_e]
created_iso: 2026-09-04T00:20:32Z
status_updated_iso: 2026-09-04T00:20:32Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [model, settings, decide, need-human]
---

Follow-up from ticket nid_u4z668hton69x0tdemih2kjwh_e (branch nid_u4z668hton69x0tdemih2kjwh_e_hide-the-settings-regarding-model-change), which hid the user-selectable embedding-model UI behind `MODEL_SELECTION_ENABLED = false` in src/settings-tab.ts.

## Problem
Hiding the "Advanced model settings" disclosure removed the ONLY UI path to change or reset the embedding model. But a persisted `settings.modelOverride` (set by any user on a prior version where the disclosure was visible) is NOT cleared:
- The status card in src/settings-tab.ts (renderModel, ~line 932-940) still renders "(custom)" and the pinned revision, so the plugin keeps embedding/searching with the custom model.
- "Reset to defaults" in src/settings-tab.ts (renderReset, ~line 1274-1287) EXPLICITLY re-applies `modelOverride` after Object.assign(DEFAULT_SETTINGS) (lines 1280-1282), so even a full settings reset leaves the override in place.

Result: a user who previously selected a custom model has no way, via the UI, to get back to the shipped default — which contradicts the ticket goal of "only allow using the default embedding model for now".

## Decision needed (why need-human)
Forcing existing overrides back to the default embedding model triggers a FULL vault re-embed (see switchModel in src/main.ts ~line 2379), which is destructive/expensive and cross-device-consent-gated. Whether to:
  (a) do nothing (accept that pre-existing overrides keep running — acceptable if the override feature never reached a released build), or
  (b) auto-migrate overrides to default on load when MODEL_SELECTION_ENABLED is false (needs a reindex + user notice), or
  (c) keep a minimal "Reset to default model" affordance visible even while the rest of the disclosure is hidden,
is a product judgment the parent ticket does not settle.

First step: determine whether any released Seeker version ever shipped the visible model-selection disclosure (git history / release tags). If it never shipped, no user can have an override and option (a) closes this.


## Notes

**2026-09-04T00:22:09Z**

Review finding (2026-09-04): the 'first step' is answered — release tag 1.1.11 (cut 2026-09-03T23:57Z) DOES contain the visible 'Advanced model settings' disclosure in src/settings-tab.ts, so users on 1.1.11 can hold a persisted modelOverride. Option (a) 'never shipped' is NOT available; a human must pick (b) auto-migrate or (c) keep a minimal 'Reset to default model' affordance.

--------------------------------------------------------------------------------

The version with model override has not been released so new users should not have the issue of older model