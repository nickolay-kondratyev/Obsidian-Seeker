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

# Cluster graph 2/3: desktop result map panel

Context: ticket `nid_7uixcj2srfixonpvnyqoabtxk_e` (`src/result-map-panel.ts`, "Show result map" setting, default ON).

## 1. Left the p85 cluster cut as-is
- Observed: on the e2e corpus the default p85 cut gives one big cluster plus many grey (ungrouped) nodes.
- Decision: no retune now.
- Follow-up: tune via the 3/3 knobs (`nid_9hlo527pksi0x5692ysfk80k8_e`) on a real vault, then update the defaults.

## 2. Grey node styling explained by caption only
- Decision: ungrouped notes are solid grey; title-only notes are hollow dashed grey. The caption "grey = not grouped" explains both.
- Possible cheap follow-up: add "(title match only)" to title-only nodes' tooltip.

## 3. Modal widens only when results paint
- Decision: the modal widens to `min(1040px, 94vw)` only when results paint, so on a session's first results the list shifts left ~200px.
- The map is hidden below window width 1120px; the width is checked once per result set (no resize listener).
