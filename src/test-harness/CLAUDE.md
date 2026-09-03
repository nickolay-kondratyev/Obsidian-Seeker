# test-harness/

`scenario.ts` — tier-2 scenario harness: drives the REAL `SearchOrchestrator` + REAL `IndexStore` (on fake-indexeddb), faking only the Vault (in-memory map) and the embedder (deterministic hash vectors). Use it to pin cross-module ordering/lifecycle invariants (delta compute → apply → stamp → drain) that unit tests can't see. Prefer plain colocated unit tests for single-module logic.

`fake-vault.ts` — the in-memory `FakeVault` on its own (no fake-indexeddb import), shared with the real-browser perf bench (`bench/harness/page.ts`); `scenario.ts` re-exports it.
