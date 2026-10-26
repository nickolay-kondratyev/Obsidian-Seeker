# Cluster graph 1/3: force defaults and options contract

Context: ticket `nid_hbu44aygn72ow3jap8bug52oe_e` (result-cluster model, `src/result-cluster-model.ts`).

## 1. Kept the spike's force-layout defaults
- Decision: the model ships with the spike's d3-force defaults unchanged.
- Known risk: on synthetic narrow-band vectors, kNN links can bunch nodes into one ~40-90° wedge.
- Why: you approved the spike's look on your real vault; synthetic test data is not representative.
- Follow-up: 2/3 (`nid_7uixcj2srfixonpvnyqoabtxk_e`) checks spread on the e2e corpus; 3/3 (`nid_9hlo527pksi0x5692ysfk80k8_e`) adds tuning knobs for retuning.

## 2. Callers pass complete options; the model does not filter `undefined`
- Decision: `buildClusterGraph` merges options with object spread, so an explicit `undefined` overrides a default. Callers must pass a complete options object.
- Why: KISS. Settings migration already fills defaults; filtering `undefined` inside the model would duplicate that.
- Guard: 3/3 adds a test that persisted/partial settings yield complete options.
