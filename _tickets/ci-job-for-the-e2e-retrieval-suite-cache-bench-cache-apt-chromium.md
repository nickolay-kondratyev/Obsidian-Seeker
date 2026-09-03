---
id: nid_xe2pqp2t53ge36dnyc4zjkrmb_e
title: "CI job for the e2e retrieval suite (cache .bench-cache + apt chromium)"
status: open
deps: []
links: []
created_iso: 2026-09-03T19:23:57Z
status_updated_iso: 2026-09-03T19:23:57Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [e2e, retrieval, ci, need-human]
---

Follow-up from plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e / ticket nid_qmnacqo5d2tqrhu90olup8ccy_e. The retrieval-quality e2e suite (npm run test:e2e, docs/e2e-retrieval.md) now runs locally and as a release.sh gate, but there is deliberately NO CI job yet (the plan defers it until the suite has been stable for a while).

Proposal (needs human sign-off — network + runtime cost on CI): add a job to .github/workflows/ci.yml that runs `E2E=1 npm run test:e2e`, with:
- actions/cache keyed on the model identity for `.bench-cache/` (the ~100 MB transformers.js model download) so only the first run pays the network cost; the frozen corpus + baseline mean the cache key is stable until an intentional re-pin.
- a system Chromium via apt (ubuntu runners: `apt-get install -y chromium-browser` or the playwright-core bundled install `npm run bench:setup`) resolved exactly like scripts/bench.mjs printLaunchInfo does.
- gating only the shipped hybrid channel (E2E_CHANNELS unset), device wasm (CI runners have no GPU), ~1-min budget.

Open questions for the human (need-human):
1. Is the added CI minutes + first-run model download acceptable, or should this stay release-gate-only?
2. Run on every PR, or only on main / a label, given the ~1-min cost and shared .bench-cache concurrency constraint with the bench?
3. Cache the model under the HF-mirror commit pin (docs) so a cache miss is deterministic?

Do not implement until (a) the suite has been observably stable across a few real changes and (b) the human answers the above.

