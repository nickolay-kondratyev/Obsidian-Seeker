// Settles the fire-and-forget work SearchOrchestrator.reindexAll() leaves behind
// so bench/harness/page.ts can close the IndexStore without spurious warnings.
//
// reindexAll() fires warmCaches() (search.ts); dispose() does not cancel it.
// warmCaches() itself fires `void persistBm25()` and clears its private
// `warming` flag right after, so polling `warming` alone returns while
// persistBm25 is still between its getMeta() read and its putBm25() write —
// store.close() then makes putBm25 throw "IndexStore not opened" (benign,
// swallowed and logged by persistBm25, but noisy on every bench run).
//
// Both `warming` and `persistBm25` are private; they are reached by element
// access (test-harness style) rather than adding a production seam for the
// bench's sake. `persistBm25` is wrapped on the INSTANCE (the prototype is
// untouched) to capture every promise it returns; the wrapper is installed
// before reindexAll() so the warm's call goes through it.
//
// Kept out of page.ts so it can run under vitest (page.ts touches window/
// indexedDB globals at import time). No fake-indexeddb import here: page.ts
// bundles this against the browser's real IndexedDB.
import type { SearchOrchestrator } from '../../src/search';
import type { ChunkMeta } from '../../src/types';

const WARM_POLL_MS = 10;

export class CacheWarmDrainer {
    private readonly persists: Promise<void>[] = [];

    constructor(private readonly orch: SearchOrchestrator) {
        const original = orch['persistBm25'].bind(orch);
        orch['persistBm25'] = (chunks: ChunkMeta[]): Promise<void> => {
            const p = original(chunks);
            this.persists.push(p);
            return p;
        };
    }

    // Resolves once no warm is in flight and every persist it fired has settled
    // (persistBm25 never rejects — it swallows its own errors).
    async drain(): Promise<void> {
        while (this.orch['warming']) await new Promise(r => window.setTimeout(r, WARM_POLL_MS));
        await Promise.all(this.persists);
    }
}
