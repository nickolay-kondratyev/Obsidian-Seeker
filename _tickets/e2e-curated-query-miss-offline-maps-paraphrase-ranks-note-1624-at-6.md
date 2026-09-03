---
session_ids: [{"a": "claude", "type": "execution", "id": "c7c3370a-e199-4312-a4bf-adabcefbbc82"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker-mirror-3
id: nid_ijete79awhl83gioovjhb4quk_e
title: "e2e curated query miss: offline-maps paraphrase ranks note 1624 at #6"
status: open
deps: []
links: []
created_iso: 2026-09-03T19:23:42Z
status_updated_iso: 2026-09-03T19:36:53Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval, finding, decide]
---

Finding from ticket nid_qmnacqo5d2tqrhu90olup8ccy_e (curated e2e queries). A reasonable hand-written SEMANTIC query missed its rank bound, so per the ticket rule it was kept OUT of the committed set (e2e/datasets/cqadupstack-android/curated-queries.json) rather than tuned to pass.

Query (zero content-word overlap with the target note, verified): "driving directions that need no internet connection" -> expected doc 1624 "Is there an offline maps application for Android?" within rank 3.

Actual shipped hybrid top 5 (wasm, denseWeight 0.85), measured 2026-09-03:
  #1 56687 "Offline maps & routs"                         score=0.7865 dense=0.9252 bm25=0.0000
  #2 4918  "...use the internet via droid X?"             score=0.7848 dense=0.9166 bm25=0.0376
  #3 69553 "How to reverse tether without rooting?"       score=0.7827 dense=0.9175 bm25=0.0193
  #4 37329 "...access internet over wi-fi..."             score=0.7822 dense=0.9119 bm25=0.0469
  #5 20495 "Connecting Android to Fedora to browse the web" score=0.7804 dense=0.8951 bm25=0.1303
  (1624 landed at #6.)

Diagnosis: this is NOT clearly a ranking bug. Note 56687 ("Offline maps & routs") is a near-duplicate of 1624 in the corpus and is an equally/more valid answer to the paraphrase, so it legitimately outranks 1624 on a pure dense signal (bm25=0 for both, no lexical overlap by design). The gold target we happened to pick is one of two offline-maps notes. The scores are also densely packed (0.780-0.787), i.e. many topically-near notes.

Options if we want this covered: (a) accept it as a corpus artifact (two valid answers) and leave it out; (b) allow expectDocId to be a SET of acceptable docs for a semantic query and assert ANY of them ranks within the bound (would let this pass honestly with {1624,56687}); (c) pick a semantic paraphrase whose target has no near-duplicate. Recommend (b) if we later want more semantic coverage, since duplicate-answer notes are inherent to StackExchange dup-question data.

No action required for the suite to be green; committed set has 5 keyword + 5 semantic passing queries.

---

## Decision needed (why this stopped for a human)

Verified 2026-09-03 (non-interactive execution session): the diagnosis holds and
there is **no bug to fix**. Both notes exist in the frozen corpus and both are
legitimate answers to the paraphrase "driving directions that need no internet
connection":

- `corpus/1624.md` — "Is there an offline maps application for Android?"
- `corpus/56687.md` — "Offline maps & routs" (offline maps + routing, Android)

So 56687 outranking 1624 on a pure dense signal (both `bm25=0`) is not a ranking
defect; it is inherent to StackExchange duplicate-question data, where a query can
have more than one equally-valid gold answer.

**The remaining choice is a methodology decision, and it is the human's to make**,
because every option changes the human-designed curated-query contract whose
stated rule (`docs/e2e-retrieval.md`) is: *queries are hand-written by reading the
corpus, never tuned by trial to make them pass; a reasonable miss is a finding, not
a reason to lower the bar.* The suite is already green with 5+5 passing curated
queries (min required per kind is 3 — `MIN_CURATED_PER_KIND` in
`e2e/datasets/cqadupstack-android.test.ts`), so nothing forces a change.

### Options

- **(a) Accept as a corpus artifact, leave the query out (status quo).** Zero code
  change, suite stays green, methodology untouched. Cost: this one reasonable
  semantic paraphrase stays uncovered. Fully reversible — the finding is documented
  above if we revisit.
- **(b) Let `expectDocId` be a SET of acceptable docs for semantic queries** and
  assert ANY of them ranks within the bound (e.g. `{1624, 56687}`). Models the
  real world correctly (dup-question data has multiple valid answers) and would let
  this query pass *honestly*. Cost: real schema + harness + pin-test work
  (`curated-queries.json` shape, `retrieval.e2e.test.ts` assertion, and the
  `cqadupstack-android.test.ts` invariants — `expectDocId` singular is assumed in
  several `it`s), and it is a genuine evolution of the "one gold doc, no lowering
  the bar" philosophy. Recommended by the finding author *only "if we later want
  more semantic coverage"* — a product desire not yet expressed.
- **(c) Replace this paraphrase with one whose target has no near-duplicate.**
  Keeps the single-gold contract, but is unrequested scope: the committed set
  already meets the 5+5 target, and finding+verifying a fresh zero-overlap
  paraphrase is new hand-authoring work.

### Recommendation

**(a) for now.** The suite is green, the finding is fully documented, and neither
(b) nor (c) is needed to hit the current coverage target. Choose (b) only if you
decide you want broader honest semantic coverage and are willing to evolve the
curated contract to first-class multi-gold answers (in which case it should be its
own ticket covering schema + harness + pin-test, applied wholesale, not bolted on
for this single query). I did not implement (b)/(c) because doing so unilaterally
would deviate from your established test methodology, and guessing wrong wastes the
harness work.

**To proceed:** pick (a), (b), or (c) here, drop the `decide` tag, and re-run this
ticket. If (a): this can simply be closed as an accepted, documented finding.

