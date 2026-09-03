---
id: nid_dgaqfjqgyi78zwcxmy3q8e6k8_e
title: "Recapture host baseline pair at BENCH_FILES=70 (two-baseline convention)"
status: open
deps: []
links: [nid_d5o2w9eb3d1l885d2q8kk992l_e]
created_iso: 2026-09-03T01:25:46Z
status_updated_iso: 2026-09-03T01:25:46Z
type: task
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [perf, bench, baseline, need-human]
---

The baseline in docs/perf-bench.md (ticket nid_d5o2w9eb3d1l885d2q8kk992l_e) was captured on the reference host with the default BENCH_FILES=12, not the BENCH_FILES=70 that the two-baseline convention in docs/perf-bench.md prescribes. At 12 files the WebGPU headline (wallClockMs) is ~2/3 the fixed post-index WebGPU buffer-pool release (see the Reading the baseline section), which blunts the 10 %-median rule for embedding levers.

Human, on the Fedora host at the repo root with Obsidian closed:

    BENCH_DEVICE=wasm   BENCH_FILES=70 npm run bench:host
    BENCH_DEVICE=webgpu BENCH_FILES=70 npm run bench:host

Then paste the summaries / the appended .bench/results.ndjson lines into this ticket. Agent: run BENCH_FILES=70 npm run bench in the container (expect ~5 min on wasm), add three new rows to the baseline table in docs/perf-bench.md, and note whether the buffer-pool-release share drops as expected.

## Acceptance Criteria

docs/perf-bench.md baseline table has host wasm, host webgpu and container wasm rows at BENCH_FILES=70 from the same commit.

