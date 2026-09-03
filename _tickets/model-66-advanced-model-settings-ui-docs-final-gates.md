---
session_ids: [{"a": "claude", "type": "execution", "id": "30141cdd-5c19-41a4-885d-ac0b78247cc6"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-2
id: nid_1zqy3m0wb155p2hidgz4z1pka_e
title: "Model 6/6: Advanced model settings UI, docs, final gates"
status: open
deps: [nid_uf0gnfjac87y3qls9mymlq5hj_e, nid_dfmajhegs6mapfmu6i4l7uy5t_e]
links: []
created_iso: 2026-09-03T20:25:50Z
status_updated_iso: 2026-09-03T22:00:41Z
type: feature
priority: 3
assignee: nickolaykondratyev
tags: [model, need-human]
---

## RESOLUTION (2026-09-03)

Implementation is COMPLETE and every AUTOMATED gate passes. The ticket is left
OPEN with `need-human` for ONE remaining step only: **item 5, the manual
verification in a real vault**, which is interactive (a human typing a custom HF
slug, clicking Validate/Switch, inspecting data.json) and cannot be run in this
non-interactive session. No automated test exercises the new Advanced-model UI
path (validate→switch), so this human pass is the feature's only end-to-end
check — please run the script at the bottom, then close the ticket.

### What was built
- `src/settings-tab.ts`
  - **Change 1 — status row** (`renderModelStatus`): model-agnostic copy —
    `Downloaded · <N> MB` / `Downloaded · size unknown` when the usageDetails
    split is unavailable, else `Not downloaded · the first search downloads the
    model`. Faint id line: `<repo> · <dim>-dim · <CLS|Mean> pooling` + ` (custom)`
    when `isOverride`; a second faint line `<repo> @ <sha7>` for an override
    (pinned commit visible without opening the disclosure). Removed the `≈100 MB`
    literals here and in the download/delete spinners + the delete Notice.
  - **Change 2 — disclosure** `Advanced model settings` (tail disclosure, own
    field `modelAdvancedOpen`). Local tab state: `candidate: ModelCandidate`
    (`ensureCandidate()` seeds from the active override, else `ACTIVE_MODEL_SPEC`
    with an empty revision) and `validation: ModelValidation | null`, cleared by
    `invalidateValidation()` on ANY field edit (Switch only enabled for the exact
    validated values; nothing is saved on keystroke).
    - Repo (`addText`; blur/Enter → `commitRepo()`: `isValidHfSlug` inline error,
      else `plugin.detectPooling` → prefill Pooling + hint "Detected from the
      repo." / "Not declared by the repo — pick manually."). `commitRepo` avoids a
      synchronous rerender on the valid path so a blur can't eat a Validate click.
    - Revision, Pooling (CLS/Mean), Precision (`q4 (smallest, default)`/`q8`/
      `fp32 (largest)` → dtype), Query prefix, Document prefix — all with the
      ticket's descriptions/placeholders.
    - Buttons: Validate (CTA; spinner + "Downloading and loading the model…";
      result line `<dim>-dim · <dtype> · <device> · pinned to <sha7>` with
      seeker-dot-good, else plain error with seeker-dot-bad; input preserved).
      `Switch model & reindex` (warning, disabled until `validation.ok`) → two-step
      `Cancel` / `Delete index & switch` with the exact consent-gated confirm copy
      (`switchConfirmText`) → `plugin.switchModel({...candidate, dim, revision})`
      (stored revision = the sha from Validate) reusing the reindex progress UI
      (`runModelSwitch` drives `reindexPhase='running'`); on a `false` return the
      plugin's Notice shows and it returns to idle.
    - `Reset to default model` (only when `isOverride`) → same confirm with the
      shipped repo → `switchModel(null)`.
    - Mobile (`isMobilePlatform()`): fields disabled, hint, no Validate/Switch.
    - Validate/Switch disabled while `plugin.isIndexing` (hint "Wait for indexing
      to finish.").
  - **Reset to defaults** (all settings) desc (both strings) now appends: 'The
    embedding model is not changed — use "Reset to default model" for that.'
- Docs: `README.md` reworded the model description ("by default the IBM Granite
  multilingual model, ~100 MB") + new "Using a different embedding model"
  subsection; `src/CLAUDE.md` added a Layers line for `model-candidate.ts` /
  `model-validate.ts` and the disclosure.

### Gates (item 4) — RESULTS
- `npm run typecheck` — **PASS** (`.tmp/typecheck.log`)
- `npm run test` — **PASS** 1571 passed / 19 skipped (`.tmp/test.log`)
- `npm run build` — **PASS** (`.tmp/build.log`)
- `node scripts/rename-plugin-id.mjs --check` — **PASS** (`.tmp/rename.log`)
- `E2E=1 npm run test:e2e:retrieval` — **PASS**, nDCG@10 0.8990 / Recall@10
  1.0000, pinned baseline holds → the default model's embed input/pooling are
  unchanged by the plumbing (`.tmp/e2e-retrieval.log`)
- `E2E=1 npm run test:e2e:obsidian` — **PASS** 14/14 (`.tmp/e2e-obsidian.log`)

Environment had Playwright Chromium 1.62.1, Obsidian 1.12.7 (cached), and
network — so the e2e gate DID run here; do not re-run to "confirm".

### Item 5 — MANUAL VERIFICATION SCRIPT (human, real desktop vault)
1. Default view unchanged; open Model & performance → Advanced model settings.
2. Repo `onnx-community/multilingual-e5-small`; prefixes `query: ` / `passage: `.
   Pooling should auto-detect **Mean**.
3. Validate → expect **384-dim**, a device, and a pinned **sha7**.
4. Switch → confirm "Delete index & switch" → reindex runs → search works.
5. Inspect `data.json`: `modelOverride.revision` is a 40-char sha (not "main"),
   and `modelOverride.dim === 384`.
6. Reset to default model → confirm → reindex → default restored.
7. Invalid slug (e.g. `not a repo`) → inline error, nothing deleted.
8. A repo lacking the chosen precision file → plain-language error, nothing
   deleted.

Then `ticket close nid_1zqy3m0wb155p2hidgz4z1pka_e`. change_log:
`bozm3bev44e8kuwmbrt4nz6ik`.

Model 6/6 — Settings UI ("Advanced model settings"), docs, final gates. READ FIRST: _tickets/plan-user-selectable-embedding-model-hf-slug-validate-then-switch-runtime-dim.md (sections "UI" and "Cross-device behavior" — the latter dictates every sentence of user-facing copy about other devices; peers do NOT auto-reindex). Depends on 5/6. Load the UI memory (${MY_DEEP_MEM}/my-frontend-design.md) and the obsidian-settings skill before writing UI code.

CONTEXT (inventory of src/settings-tab.ts): class SeekerSettingTab L116; display() L145, rerender() L170, loadData() L197, `this.s` = live settings L212, `save` L213. Disclosure pattern L259-264 (div.seeker-disclosure + chevron span + own boolean open-state field, body wrapped in an unstyled div.seeker-adv). addSegmented L801; addToggle example L273; addDropdown example L302-310 (with post-save Notice); there is NO addText usage yet (use Obsidian's Setting.addText). Two-step destructive confirm patterns: reindexPhase state machine L368-409 (Cancel / 'Delete & reindex' warning button) and modelDeleteConfirm L661-707. renderModel L632-659, renderModelStatus L661-707 (copy hardcodes '≈100 MB'), downloadModel L709-718, deleteModel L720-734. Reset section L758-779 resets ALL settings. styles.css classes: seeker-disclosure/-chev, seeker-dot(-good/-mid/-bad), seeker-faint, seeker-model-id, seeker-inline-warn, seeker-hint, seeker-spinner. Plugin API from 5/6: detectPooling, validateModelCandidate, switchModel, getModelStatus (name, dim, pooling, isOverride, downloaded, persisted), isIndexing; ModelCandidate / ModelValidation types from src/model-validate.ts; isMobilePlatform from src/platform.ts. Reset section L758-779: `Object.assign(this.s, DEFAULT_SETTINGS)` leaves modelOverride untouched (DEFAULT_SETTINGS has no such key) — wanted; see change 2.

CHANGES
1. Embedding-model status row: copy becomes model-agnostic — 'Downloaded · <size> MB' when known, 'Not downloaded · the first search downloads the model' otherwise; the faint id line shows '<repo> · <dim>-dim · <CLS|Mean> pooling' and '(custom)' when isOverride.
2. New disclosure 'Advanced model settings' under the status row (own field modelAdvancedOpen). Local tab state `candidate: ModelCandidate` seeded from the active override (or the shipped default's values) and `validation: ModelValidation | null` (cleared whenever any field changes, so Switch is only enabled for the exact validated values):
   - Repo (addText, placeholder 'owner/model-name'); on change (blur/Enter): clear validation, run isValidHfSlug → inline error text if bad; if good, call plugin.detectPooling → set the Pooling dropdown + hint 'Detected from the repo' / 'Not declared by the repo — pick manually'.
   - Revision (addText, placeholder 'main (pinned on Validate)'; desc: 'Branch, tag or commit. Validate pins it to an exact commit so every device uses identical model files.'); Pooling (addDropdown CLS/Mean); Precision (addDropdown: 'q4 (smallest, default)', 'q8', 'fp32 (largest)'); Query prefix and Document prefix (addText; desc gives the e5 example 'query: ' / 'passage: ' and says to include the trailing space).
   - Buttons row: 'Validate' (CTA; spinner + 'Downloading and loading the model…' while running; result line: '<dim>-dim · <dtype> · <device> · pinned to <sha7>' with seeker-dot-good, or the plain-language error with seeker-dot-bad, input preserved). 'Switch model & reindex' (warning; disabled until validation.ok) → two-step confirm in the same row pattern as 'Delete & reindex': 'Cancel' / 'Delete index & switch'. Confirm text: 'Switch to <repo>? Seeker deletes the current index (<N> notes) and re-embeds everything with the new model on this device. Other devices sync the new index from this one (when the shared index is on) or show a reindex banner, and each one downloads the new model on its next search — phones included.' (Do NOT write "other devices rebuild automatically": the identity cascade is consent-gated — plan "Cross-device behavior".) On confirm: plugin.switchModel({ ...candidate, dim: validation.dim, revision: validation.revision }, onProgress) — the STORED revision is always the sha from Validate, never the raw field text and reuse the existing reindex progress UI (reindexPhase 'running'); on a false return (refused) show the plugin's Notice reason and go back to the confirm-idle state.
   - Status line for an active override shows '<repo> @ <sha7>' so the pinned revision is visible without opening the disclosure.
   - 'Reset to default model' (visible only when isOverride) → same confirm wording with the shipped model name → switchModel(null).
   - Mobile (isMobilePlatform()): render the fields read-only (disabled) with a seeker-hint 'Change the model from a desktop device. This device then syncs the new index from it and downloads the new model on its next search.' No Validate/Switch buttons.
   - 'Reset to defaults' (all settings, L758-779): append to both desc strings 'The embedding model is not changed — use "Reset to default model" for that.' (its Object.assign cannot clear modelOverride; that is intended, a reset must never silently change the index identity).
   - While plugin.isIndexing: Validate/Switch disabled with hint 'Wait for indexing to finish.'
3. Docs: README.md L45-50 — reword to 'the embedding model (by default the IBM Granite multilingual model, ~100 MB)…' and add a short 'Using a different embedding model' subsection (advanced settings, HF slug, pooling/precision/prefixes, validate then switch, full reindex, all devices rebuild). src/CLAUDE.md: one line under Layers for model-candidate.ts and the settings-tab disclosure; keep succinct.
4. FINAL GATES (this ticket closes the epic): `npm run typecheck`, `npm run test`, `npm run build`, `node scripts/rename-plugin-id.mjs --check`, and `E2E=1 npm run test:e2e` (docs/e2e-retrieval.md; the default model is unchanged so the pinned baseline must still pass — if it regresses, the plumbing changed the default's embed input or pooling; find the cause, do not re-pin). Redirect verbose output to .tmp/. The e2e gate and the manual check (item 5) need a resolvable Chromium / a real Obsidian + network: if this environment cannot run them, SAY SO explicitly in the ticket notes, leave the ticket open with the `need-human` tag, and list exactly which gates passed — never report a gate as passed that did not run. Record results in this ticket + a change_log entry (impact 4, feature).
5. Manual verification in a real vault (document what you ran): default view unchanged; open the disclosure; enter e.g. 'onnx-community/multilingual-e5-small' (or another small ST ONNX repo) with prefixes 'query: ' / 'passage: '; pooling detects mean; Validate reports 384-dim and a pinned sha7; after Switch, data.json modelOverride.revision is the 40-char sha; Switch → confirm → reindex runs; search works; Reset to default → confirm → reindex; an invalid slug shows the inline error; a repo without the chosen precision file shows the plain-language error and nothing is deleted.

