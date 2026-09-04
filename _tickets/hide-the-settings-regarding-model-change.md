---
closed_iso: 2026-09-04T00:17:43Z
session_ids: [{"a": "claude", "type": "execution", "id": "d858e411-ce00-41ad-a095-e1ff6e0210de"}, {"a": "claude", "type": "review", "id": "e35545f3-52c6-45ed-94f4-5e08377bcc66"}, {"a": "claude", "type": "review", "id": "e5960346-f03b-4158-9cb0-7cfaca3f5183"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_u4z668hton69x0tdemih2kjwh_e
title: "Hide the settings regarding model change"
status: closed
deps: []
links: [nid_45vpzmg10gvd7vr84zpddit2r_e]
created_iso: 2026-09-04T00:14:35Z
status_updated_iso: 2026-09-04T00:17:43Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

Hide the settings regarding ability to change the default model. We are going to only allow using the default embedding model for now.

## Resolution

Hid the **Settings → Model & performance → "Advanced model settings"** disclosure —
the user-selectable embedding model UI (Repo / Revision / Pooling / Precision /
prefixes / Validate / Switch / Reset to default model). Everything else in the
section stays: Compute backend, the WebGPU-demoted reset, and the Embedding-model
status card (Downloaded/size, Download now, Delete).

### Approach — feature flag, not deletion
This is a "for now" hide, and the switch machinery is large and thoroughly
unit-tested (`ModelDraft`/`model-draft.ts`, `model-candidate.ts`,
`model-validate.ts`, plus the `detectPooling`/`validateModelCandidate`/`switchModel`
wiring in `main.ts`). Deleting it would be a big, lossy change against 80/20, so
instead a module-level flag gates only the UI:

- `src/settings-tab.ts`: new const `MODEL_SELECTION_ENABLED = false` (near the top,
  with a WHY comment). `renderModelStatus()` now `return`s before building the
  disclosure when the flag is off. Flip to `true` to re-surface it — one line.
- The unused private methods (`renderModelAdvanced`, `renderModelActions`, etc.) and
  the `draft` field remain; tsc does not flag unused class members, typecheck passes.

### Docs kept honest
- `README.md`: removed the "Using a different embedding model" section and its
  cross-reference in "Network Use" (the UI it described is gone).
- `src/CLAUDE.md`: noted the disclosure is HIDDEN behind `MODEL_SELECTION_ENABLED`.

### Verification
`npm run typecheck`, `npm run build`, and `npm run test` (1606 passed, 19 skipped)
all green. No e2e/test referenced the disclosure.
## Notes

**2026-09-04T00:20:58Z**

__REVIEW_AGAIN__: Hide is clean + tests green; fixed stale 'Reset to default model' copy (899772c), but filed nid_45vpzmg10gvd7vr84zpddit2r_e — pre-existing modelOverride has no UI path back to default; warrants a fresh look.

**2026-09-04T00:22:09Z**

__READY_AS_IS__: flag-gated hide is correct, no dangling copy, typecheck+1606 tests green; only open concern (stranded modelOverride from shipped 1.1.11) is tracked in need-human ticket nid_45vpzmg10gvd7vr84zpddit2r_e.
