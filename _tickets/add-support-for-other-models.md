---
id: nid_s0rj0qtgibopdgr3tgvvkusad_e
title: Add support for other models
status: in_progress
deps: []
links: []
created_iso: '2026-09-02T23:22:16Z'
status_updated_iso: '2026-09-03T20:04:51Z'
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker
---
--------------------------------------------------------------------------------
TASK: **PLAN**. Reach a shared understanding of this ticket before writing any plan.

## Interview
Treat the work as a design tree: each decision unlocks the decisions below it. Work in rounds. Each round, ask every question whose prerequisites are settled; questions that depend on an open question wait for a later round.

Split decisions into two kinds:
- **AGENT decides**: anything a fact settles, or where one option is clearly right. Find facts yourself (dispatch `Explore-cheap` for code base or environment questions; don't block the round on it). Decide, and list each decision with a one-line reason so the HUMAN can veto.
- **HUMAN decides**: true judgment calls: tradeoffs, scope, product intent, anything the AGENT would only be guessing at. Put each to the HUMAN and wait.

A question goes to the HUMAN only if it clears this bar: the answer changes the plan, AND it cannot be settled by a fact, AND the ticket, code base, or conventions don't already imply the answer. If the answer could be inferred with reasonable confidence, make the call under AGENT decides and let the HUMAN veto. Do NOT ask questions to appear thorough. Zero questions is a valid and expected outcome for a clear ticket.

## Asking
Do NOT use AskUserQuestion. Each round, overwrite `.out/current_decision.md` (git-ignored) with:
1. A concise summary of the problem and the key tradeoffs.
2. **AGENT decided**: what you settled yourself, one line each.
3. **HUMAN decides**: the numbered questions, formatted:

❓ **Q1** - **<title>**: <question, may include options>

➡️ <AGENT's recommendation>

---

Then tell the HUMAN to read the file and reply. After each reply, recompute the frontier and ask the next round. Done when nothing is left to ask and the HUMAN confirms a shared understanding.

If the first round produces no HUMAN questions, still write the file (summary plus AGENT decided), tell the HUMAN it needs only a veto pass, and proceed to Output once they confirm or after they reply with no objections. Do not manufacture questions to fill the section.

## Output
Only after that confirmation, write the detailed plan with requirements.
IF multiple tickets are needed
THEN put the high-level plan into a new ticket and `close` it,
AND create focused implementation tickets with `ticket dep <impl-id> <plan-id>`
ELSE put the plan into a new `open` ticket.
Split so each ticket fits in a 200K context window and is self contained: full relative paths from git root, key details included, since a less capable model will execute it.
Finally `close` this ticket.
--------------------------------------------------------------------------------

GOAL:
I am thinking right now the plugin could become outdated just because you cannot change the model.

Hence, I am thinking it would make sense to allow override of the model. Presuming that we would load the model from hugging face, like we do with real model. I am thinking the main use case is to allow models that are do not yet even exist -> Hence we want to allow free entry of some model slug or URL (whatever is the proper way to get models from hugging face). I am also wondering whether we should allow loading a model from local as well (hugging face and local, advise me on whether local is worth it or whether all open models are on hugging face as well and its not worth it).

Key parts in the design that we want to address is that once we change the model we will need to re-index everything with the new model so there should be a user confirmation prior to the change as its destructive operation (destructive of indexing data). I am thinking to KISS and not keep the older model indexes for now.

## Notes

**2026-09-03T20:09:01Z**

PLAN interview round 1 written to .out/current_decision.md (git-ignored); copy of the round below so a later session can resume.

# Ticket nid_s0rj0qtgibopdgr3tgvvkusad_e — "Add support for other models" — Round 1

## Problem summary

Today the embedding model is a compile-time constant. `src/model-registry.ts` defines ONE shipped spec
(`tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX`, 384-d, CLS pooling, dtype q4, pinned revision) and
`embedder.ts` exports `MODEL_ID` / `MODEL_REVISION` / `EMBEDDING_DIM` as module constants derived from it.
Those constants feed: the index identity gate (`identity.ts`), the sidecar cross-device gate (`sidecar-meta.ts`),
the sidecar record stride (`sidecar.ts` Q_BYTES/SIGN_BYTES = 384/48 bytes, compile-time), the iframe's
`OUTPUT_DIM` (injected at child-script build), default meta in `index-store.ts`, and ~8 sites in `search.ts`.

What already exists (good news):
- A **debug-only** `modelRepoOverride` / `modelRevisionOverride` in `SeekerSettings` (data.json only, no UI).
  It loads an arbitrary HF repo, BUT it assumes dim 384 / dtype q4 / CLS pooling, and the identity cascade
  explicitly skips it ("would loop") because identity still keys off the compiled constants.
- Model-vs-index drift detection → Notice "reindex needed" (`main.ts warnOnModelIndexDrift`).
- Cache-API eviction of the previous model's bytes on a switch (`evictStaleModelCaches`, keyed on repo).
- Settings tab "Embedding model" row: download status, Download now, two-step Delete.
- transformers.js loader already supports a local/non-HF base URL (`app://local/...`, `http(s)://`) via
  `env.allowLocalModels` — the Phase-5 `LOCAL_MODEL` dev toggle loads a model folder from the vault.
- History note (embedder.ts ~L100): a per-vault model CHOICE existed 2026-06-10..11 and was deleted because
  "one model that can't be wrong for a vault beats a setting whose wrong value silently degrades dense ranking".
  This ticket re-opens that door on purpose (future-proofing); the plan must make silent degradation hard.

## Key tradeoffs

1. **Fixed 384-d vs runtime dim.** Cheapest path keeps dim=384 and truncates larger vectors (the iframe already
   has `sliceAndRenormalize`). That works well only for native-384 models and Matryoshka models; a non-MRL
   768-d model truncated to 384 is degraded. Runtime dim is a real but bounded refactor (sidecar stride, binary
   sign-bit width, identity, iframe injection, meta default, search.ts sites) — the code is already written
   "derive from spec.dim", just from a constant instead of settings.
2. **Arbitrary model correctness knobs.** Different models need different pooling (CLS vs mean), some need
   query/document prefixes (e5: "query: "/"passage: "; nomic: "search_query: "/"search_document: "), and
   repos ship different quantized files (model_q4 / model_quantized(q8) / model.onnx). Wrong values = the
   silent-degradation failure mode the history warns about. Each knob is small; the question is scope.
3. **Destructive switch.** Switching nukes the index (KISS, per ticket). Two safety layers are cheap:
   validate-before-destroy (load the new model + embed a probe text BEFORE deleting anything; on failure
   nothing changes) and an explicit confirm ("deletes index of N notes, downloads ~model, re-embeds").
4. **Local vs Hugging Face.** See Q2.

## AGENT decided (veto if wrong)

- **Model config becomes a synced setting (data.json), replacing the debug override.** `SeekerSettings.model?:
  { repo, revision, dim, pooling, dtype, queryPrefix, docPrefix }`; absent = shipped default. Synced on purpose:
  the index identity on every device follows it, and the existing sidecar/identity cascade (hydrate from a peer
  with the same model, else desktop auto full-reindex / mobile wait) does the cross-device work for free.
- **Identity derives from settings at runtime**, not compile-time constants. `pluginIdentity()` /
  `identityHealEligibility` / `MODEL_ID` consumers take the active spec; the "override skips cascade" carve-out
  is deleted. This is the core refactor and the reason a plan ticket is needed.
- **Runtime dim (Tradeoff 1)**: go runtime. Rationale: "models that don't exist yet" will not all be 384-d; the
  code already derives every stride from `spec.dim`, so the change is plumbing a value instead of a constant.
  Sidecar records already store `dim` per entry; `SIDECAR_FORMAT` bumps. No slicing/truncation: the model's
  native width is the dim (MRL slicing = follow-up ticket, not v1).
- **Dim is auto-detected, never typed by the user**: the validate step embeds a probe string and records the
  vector length into the setting. Removes the "user typed 768 but model is 1024" failure class.
- **Pooling**: explicit `CLS | Mean` selector, prefilled by auto-detect from the repo's
  `1_Pooling/config.json` (sentence-transformers convention; present on most Xenova/onnx-community repos).
  If the file is absent, default Mean (the BERT-family norm; granite/ModernBERT are the CLS minority and the
  shipped default already carries CLS). Wrong pooling degrades quietly, so the selector stays visible.
- **Dtype**: explicit `q4 | q8 | fp32` selector (default q4). transformers.js maps these to
  `onnx/model_q4.onnx` / `model_quantized.onnx` / `model.onnx`; the validate step fails loud with the missing
  file name if the repo lacks that export. The WebGPU ladder's fp32 lifeboat stays.
- **Token budget stays 512 / seq buckets unchanged** for v1 (every mainstream embedder handles ≥512 positions;
  tokenizer truncation covers the rare 256-max model). Noted as follow-up per `src/CLAUDE.md` §Chunking.
- **Switch flow**: Settings → Model & performance → "Change model…" disclosure (repo, pooling, dtype, revision,
  prefixes) → **Validate** (downloads + loads in the iframe, reports dim/pooling detected, no index touched) →
  enabled **Switch model & reindex** (warning button) → in-tab confirm (same pattern as the existing
  "Delete & reindex" two-step, wording states index deletion + note count + download) → save settings, evict old
  model bytes (existing `evictStaleModelCaches`), teardown embedder, `runFullReindex`. A "Reset to default
  model" button routes through the same confirm.
- **Free-text HF slug only** (`owner/name`) with basic shape validation; no curated dropdown in v1 (ticket asks
  for free entry; a curated list is a cheap follow-up once a couple of models are proven).
- **Revision** stays an optional advanced field (default: track `main`). The shipped default keeps its pin.
- **Model status row** shows the active repo name + detected dim for any model (already does), and the
  "≈100 MB" copy becomes model-agnostic ("size varies by model").
- **Retrieval e2e gate / bench** remain pinned to the shipped default; not part of this ticket.

## HUMAN decides

❓ **Q1** - **Scope of correctness knobs in v1**: Which of these ship in v1? (a) pooling selector + auto-detect,
(b) dtype selector, (c) query/document prefix fields. Options: **all three**; **a+b only** (prefixes as
follow-up); **repo + revision only** (assume CLS/q4, accept degradation for non-granite-like models).

➡️ **All three.** Each is ~a settings field plus one plumbing point (pooling → iframe pipeline option;
dtype → already a load arg; prefixes → prepend at query embed in `search.ts` and at doc embed input in
`token-budget.ts embedInput`, both stamped into identity). Without (c) the two most popular multilingual
families (e5, nomic) silently underperform, which is exactly the failure the 2026-06 removal warned about.

❓ **Q2** - **Local model support (you asked for advice)**: Support loading a model folder from the vault
(and/or an arbitrary http(s) base URL) in v1, or HF-slug only?

➡️ **HF-slug only in v1; create a follow-up ticket for local/URL.** Reasoning: every open embedding model of
note is published on HF, and you already publish your own custom exports there (the shipped model is your
`tooape/...` GBQ4 export) — "not on HF" is a rare case that takes minutes to fix by uploading. The real cases
for local are air-gapped/HF-blocked machines and private fine-tunes. Costs of local-in-vault: the 60 MB–1 GB
folder lands inside the vault so Obsidian Sync/iCloud replicate it to every device (mobile included), the
Cache-API download/delete/evict status machinery does not apply (local loads bypass the browser cache), per-device
presence must be verified, and a URL base is currently loaded UNCACHED (re-fetched on each load) — so URL
support is not actually free. The Phase-5 dev toggle proves the tech works, so the follow-up is low-risk when
someone asks for it.

❓ **Q3** - **Runtime dim vs fixed 384**: Confirm runtime dim (AGENT decision above). The alternative — keep
384 and truncate — cuts roughly a third of the implementation (no sidecar/binary/identity dim plumbing) but
only serves native-384 or Matryoshka models well.

➡️ **Runtime dim.** It is the point of the ticket ("models that don't exist yet"), and the stride code is
already spec-derived. Listed as a question only because it is the single biggest cost lever.
