// Production model delivery — the registry of shippable embedding models, the
// runtime resolution of the ACTIVE model from settings, and the pure helpers
// main.ts uses to evict a previous model's bytes from the transformers.js Cache
// API on a switch.
//
// WHY a registry. The ~100 MB ONNX model is fetched at runtime by transformers.js
// inside the embed iframe (marketplace plugins ship only main.js/manifest/css, so
// the model can't be bundled). transformers.js streams it from the HF CDN and
// caches it in the browser Cache API ('transformers-cache') — per-device, never
// synced, outside the vault: the Smart Connections pattern, and on iOS the only
// store that can hold 100 MB (requestUrl can't stream that on mobile, and a plugin
// can't write outside the vault sandbox). The registry adds the missing management
// layer: versioning, multi-repo support, and eviction of the old model on a switch.
//
// IDENTITY IS RUNTIME. There are no compile-time MODEL_ID / EMBEDDING_DIM constants:
// activeModelSpec(settings) is THE source every consumer reads (identity.ts
// pluginIdentity, search.ts meta stamps, main.ts load + drift checks). `key` is the
// drift-identity stamp stored as meta.modelId (see modelKeyFor); `revision` is
// threaded into the transformers.js load (createPipeline/from_pretrained both take
// a `revision` option, verified against tx.js 4.2.0) AND into the sidecar version
// gate, so a pinned commit sha makes embeddings reproducible across devices/time
// and refuses cross-revision sidecar hydration (F10). Eviction still matches on
// repo alone (a revision bump's stale bytes are reclaimed by the OS / next switch).

import type { Dtype, Pooling, SeekerSettings } from './types';

export interface ModelSpec {
    // Index drift-identity (stored as meta.modelId + sidecar meta.modelId). Built by
    // modelKeyFor — equals `repo` for the shipped default.
    key: string;
    // HF hub id (owner/name). The load base transformers.js streams from the CDN.
    repo: string;
    // Pinned commit sha/tag passed to transformers.js; null = track main.
    revision: string | null;
    dim: number;
    dtype: Dtype;
    pooling: Pooling;
    // Text prepended to queries / indexed chunks ('' = none). See types.ts ModelOverride.
    queryPrefix: string;
    docPrefix: string;
}

// What LocalEmbedder.load takes. `dim: null` = "detect the width, don't check it" —
// used ONLY by candidate validation (a not-yet-trusted user model, ticket 5/6);
// every production load passes a ModelSpec (assignable: number ⊂ number | null),
// and the iframe fails loud when the measured width differs (ticket 3/6).
export type ModelLoadSpec = Omit<ModelSpec, 'dim'> & { dim: number | null };

// The ml97 GBQ-int4 model shipped today. `key` mirrors the legacy MODEL_ID string
// exactly — the no-reindex-on-upgrade guarantee (model-registry.test.ts pins it).
export const ML97_GBQ4: ModelSpec = {
    key: 'tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX',
    repo: 'tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX',
    // Pinned to an immutable commit sha (F10): transformers.js fetches resolve/<sha>
    // and the sidecar gate refuses cross-revision hydration, so two devices can't mix
    // vector spaces if the repo's `main` ever moves. Bump this when shipping a new
    // build (fires model-vs-index drift → full reindex). NOTE: changing it re-fetches
    // the model bytes once — the resolve URL, and thus the Cache-API key, changes.
    revision: '54db88c5667bd79b4aea24ea6027a7ef45a7bbb5',
    dim: 384,
    dtype: 'q4',
    // ModernBERT sibling of english-r2: CLS pooling, no query/doc prompts (the graph
    // is the sentence-transformers flavor; tx.js applies CLS+normalize itself).
    pooling: 'cls',
    queryPrefix: '',
    docPrefix: '',
};

export const MODEL_REGISTRY: Record<string, ModelSpec> = {
    [ML97_GBQ4.key]: ML97_GBQ4,
};

// The model Seek ships with by default. A code-level model switch = point this at
// a different registered key (and add its ModelSpec) — the identity follows, and
// the existing identity gate routes every device to a full reindex / re-hydrate.
export const ACTIVE_MODEL_KEY = ML97_GBQ4.key;

// The default active spec (no settings override).
export const ACTIVE_MODEL_SPEC = MODEL_REGISTRY[ACTIVE_MODEL_KEY];

// The index drift-identity string for a model. The shipped default keeps its plain
// repo (= the pre-2026-09 MODEL_ID, so upgrading never re-identifies an existing
// index); any other repo/pooling/docPrefix combination is spelled out so two
// overrides that embed the same repo differently can't share an index.
//
// revision and dim are deliberately NOT in the key: IndexIdentity.revision/dim
// (identity.ts identityMatches) and the sidecar MetaExpectation (sidecar-meta.ts
// metaAccepts) already carry and compare them as their own fields. dtype is not
// identity either (the WebGPU ladder already mixes q4/fp32 vectors across devices),
// nor is queryPrefix (query-side only; no stored vector changes).
export function modelKeyFor(m: Pick<ModelSpec, 'repo' | 'pooling' | 'docPrefix'>): string {
    const d = ML97_GBQ4;
    if (m.repo === d.repo && m.pooling === d.pooling && m.docPrefix === d.docPrefix) return m.repo;
    return `${m.repo}|pool=${m.pooling}|doc=${m.docPrefix}`;
}

// The model to load right now: the user's override, else the shipped default.
// Pure + settings-only (no embedder), so the cold-boot identity gate can run it
// before any model load.
export function activeModelSpec(settings: SeekerSettings): ModelSpec {
    const o = settings.modelOverride;
    // key LAST: a ModelSpec is structurally assignable to ModelOverride, so a
    // persisted override could carry a stale `key` — the computed one must win.
    return o ? { ...o, key: modelKeyFor(o) } : ACTIVE_MODEL_SPEC;
}

// The ONNX weight file transformers.js requests under `onnx/` for each dtype
// (tx.js 4.2.0 naming). Exhaustive over Dtype so a new dtype can't silently
// fall through to a wrong probe.
const WEIGHT_FILE_BY_DTYPE: Record<Dtype, string> = {
    q4: 'model_q4.onnx',
    q4f16: 'model_q4f16.onnx',
    q8: 'model_quantized.onnx',
    fp32: 'model.onnx',
};

// ---- Cache-API eviction (parent-side; orchestrated from main.ts) --------------
// transformers.js caches model files in caches.open('transformers-cache') keyed by
// the HF resolve URL `https://huggingface.co/<repo>/resolve/<rev>/<file>` (verified
// against the shipped @huggingface/transformers@4.2.0 bundle). On a model switch we
// delete every cached HF model request that is NOT the active repo, reclaiming the
// old model's ~100 MB. Pure predicate below is unit-tested; the orchestration that
// opens `caches` lives in main.ts (and is benign if the cache is absent).

export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

// True if `url` is a transformers HF model fetch for some repo OTHER than keepRepo.
// Matches the repo as a path segment (`/<repo>/resolve/`) so a repo that is a prefix
// of another (…/granite vs …/granite-2) is not mistakenly kept or evicted.
export function shouldEvictCacheUrl(url: string, keepRepo: string): boolean {
    if (!url.includes('huggingface.co') || !url.includes('/resolve/')) return false;
    return !url.includes(`/${keepRepo}/resolve/`);
}

export interface EvictionResult { seen: number; deleted: number }

// True if `url` is a transformers HF model fetch FOR `repo` — the entries a user-invoked
// "Delete model" removes. The mirror of shouldEvictCacheUrl: same HF/resolve guard and
// same path-segment match (`/<repo>/resolve/`, prefix-safe), but the predicate is
// inverted from "every repo but this one" to "exactly this one".
export function isCacheUrlForRepo(url: string, repo: string): boolean {
    if (!url.includes('huggingface.co') || !url.includes('/resolve/')) return false;
    return url.includes(`/${repo}/resolve/`);
}

// Delete the ACTIVE model's cached bytes (settings "Delete model"). The inverse of
// evictStaleModelCaches — there we drop every repo EXCEPT keepRepo; here we drop exactly
// the entries for `repo`, leaving the jsdelivr runtime and any other repo untouched.
// Best-effort + benign + parent-side, with the same iPhone visibility caveat as eviction
// (seen === 0 → the parent can't reach the iframe's cache; the bytes stay until reload).
export async function deleteModelCaches(
    caches: CacheStorage,
    repo: string,
): Promise<EvictionResult> {
    if (!(await caches.has(TRANSFORMERS_CACHE_NAME))) return { seen: 0, deleted: 0 };
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const reqs = await cache.keys();
    let deleted = 0;
    for (const req of reqs) {
        if (isCacheUrlForRepo(req.url, repo)) {
            // Best-effort per entry: a single rejected delete (rare) must not abort the
            // sweep and strand the rest of the model's bytes half-removed. Worst case we
            // under-count `deleted`; the next delete / search retries the leftovers.
            try { if (await cache.delete(req)) deleted++; } catch { /* skip this key */ }
        }
    }
    return { seen: reqs.length, deleted };
}

// Open the transformers cache and delete stale-repo entries. Best-effort + benign:
// if the cache is absent (never populated, or — should not happen with our
// non-sandboxed, same-origin iframe — partitioned away from the parent) it returns
// {0,0} and the old bytes are left for the OS to reclaim. The caller logs the
// result so `seen === 0` is visible (the signal to move eviction into an iframe RPC
// if it ever shows up on a real device). Typed against the DOM `CacheStorage`; unit
// tests inject a structural fake via `as unknown as CacheStorage`.
export async function evictStaleModelCaches(
    caches: CacheStorage,
    keepRepo: string,
): Promise<EvictionResult> {
    if (!(await caches.has(TRANSFORMERS_CACHE_NAME))) return { seen: 0, deleted: 0 };
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const reqs = await cache.keys();
    let deleted = 0;
    for (const req of reqs) {
        if (shouldEvictCacheUrl(req.url, keepRepo)) {
            if (await cache.delete(req)) deleted++;
        }
    }
    return { seen: reqs.length, deleted };
}

// ---- Cache-API download probe (read-only; for the settings model status) -------
export interface ModelCacheStatus {
    // The model's ~100 MB ONNX weights are present in the Cache API (vs. an aborted
    // fetch that left only the small JSON configs, or nothing). This is the
    // "Downloaded — survives reloads, evictable by iOS" state the settings tab shows,
    // distinct from "loaded into runtime memory" (which the search modal signals).
    downloaded: boolean;
    // navigator.storage persistence: true = persistent-storage granted, so the cache
    // won't be silently evicted under pressure ("stored permanently"); false = "may be
    // evicted"; null = the API is unavailable (don't render the nuance).
    persisted: boolean | null;
}

// Read-only probe of whether the active model is cached on disk. Matches the ONNX
// weight file by repo + filename FRAGMENTS in the cache keys, rather than rebuilding
// the exact resolve URL — the revision segment is `main` vs a pinned sha depending on
// the load path, and fragment-matching is robust to either (same approach as
// shouldEvictCacheUrl). Best-effort and NEVER throws: any failure (no Cache API,
// origin-partitioned cache, rejected open) resolves to { downloaded:false } so it can
// never blank the settings tab. NOTE the parent-side-visibility caveat — on a real
// iPhone the parent may not see the iframe's cache (the `cacheSeen` canary in the
// model-delivery log); the caller falls back to that log when this returns false.
export async function probeModelDownloaded(
    caches: CacheStorage,
    spec: Pick<ModelSpec, 'repo' | 'dtype'>,
): Promise<ModelCacheStatus> {
    let persisted: boolean | null = null;
    try {
        if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
            persisted = await navigator.storage.persisted();
        }
    } catch { /* unsupported / private mode */ }
    try {
        if (!(await caches.has(TRANSFORMERS_CACHE_NAME))) return { downloaded: false, persisted };
        const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
        const reqs = await cache.keys();
        // The largest file is the ONNX weights; its presence is the download canary
        // (the small JSON configs alone = a partial/aborted fetch).
        const weightFile = WEIGHT_FILE_BY_DTYPE[spec.dtype];
        const downloaded = reqs.some(r =>
            r.url.includes(`/${spec.repo}/resolve/`) && r.url.includes(weightFile));
        return { downloaded, persisted };
    } catch {
        return { downloaded: false, persisted };
    }
}
