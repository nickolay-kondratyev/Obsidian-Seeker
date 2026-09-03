// Unit tests for the production model-delivery registry: runtime active-spec
// selection (settings override vs shipped default), the identity key, and the parent-side Cache-API eviction that
// reclaims a previous model's ~100 MB on a switch. Pure — no DOM/iframe; the Cache
// API is a structural fake injected as CacheStorage.

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type ModelOverride, type SeekerSettings } from './types';
import {
    ACTIVE_MODEL_SPEC,
    ML97_GBQ4,
    activeModelSpec,
    modelKeyFor,
    shouldEvictCacheUrl,
    evictStaleModelCaches,
    isCacheUrlForRepo,
    deleteModelCaches,
    probeModelDownloaded,
} from './model-registry';

const ACTIVE_REPO = ML97_GBQ4.repo;
// Only modelOverride is read; the rest is irrelevant.
const settings = (o: Partial<SeekerSettings> = {}): SeekerSettings => o as unknown as SeekerSettings;

const hfUrl = (repo: string, file = 'onnx/model_q4.onnx') =>
    `https://huggingface.co/${repo}/resolve/main/${file}`;

const OVERRIDE: ModelOverride = {
    repo: 'acme/my-embed', revision: 'deadbeef', dim: 768, pooling: 'mean', dtype: 'q8', queryPrefix: 'query: ', docPrefix: 'passage: ',
};

describe('modelKeyFor (index drift-identity string)', () => {
    it('the shipped default stays the plain repo (= the legacy MODEL_ID)', () => {
        expect(modelKeyFor(ML97_GBQ4)).toBe(ML97_GBQ4.repo);
    });

    it('an override of the shipped repo with the same pooling/prefix keeps the plain repo key (a revision change is caught by identity.revision)', () => {
        expect(modelKeyFor({ repo: ML97_GBQ4.repo, pooling: 'cls', docPrefix: '' })).toBe(ML97_GBQ4.repo);
    });

    it('same repo but mean pooling differs', () => {
        expect(modelKeyFor({ repo: ML97_GBQ4.repo, pooling: 'mean', docPrefix: '' }))
            .toBe(`${ML97_GBQ4.repo}|pool=mean|doc=`);
    });

    it('docPrefix differs', () => {
        expect(modelKeyFor({ repo: ML97_GBQ4.repo, pooling: 'cls', docPrefix: 'passage: ' }))
            .toBe(`${ML97_GBQ4.repo}|pool=cls|doc=passage: `);
    });

    it('a foreign repo is always spelled out', () => {
        expect(modelKeyFor(OVERRIDE)).toBe('acme/my-embed|pool=mean|doc=passage: ');
    });
});

describe('activeModelSpec', () => {
    it('no override → shipped default spec', () => {
        expect(activeModelSpec(settings())).toBe(ACTIVE_MODEL_SPEC);
    });

    // The no-reindex-on-upgrade guarantee: the identity string a default install
    // stamps into meta.modelId must equal what every pre-runtime-model build wrote.
    it('DEFAULT_SETTINGS resolves to the exact legacy MODEL_ID identity', () => {
        expect(activeModelSpec(DEFAULT_SETTINGS).key).toBe('tooape/granite-embedding-97m-multilingual-r2-GBQ4-ONNX');
    });

    it('an override becomes the spec verbatim, keyed by modelKeyFor', () => {
        const s = activeModelSpec(settings({ modelOverride: OVERRIDE }));
        expect(s).toEqual({ key: modelKeyFor(OVERRIDE), ...OVERRIDE });
        expect(s.key).toBe('acme/my-embed|pool=mean|doc=passage: ');
    });

    it('a persisted override carrying a stale `key` field never overrides the computed key', () => {
        // A ModelSpec is assignable to ModelOverride, so data.json can end up with a `key`.
        const stale = { ...OVERRIDE, key: 'stale/key' } as ModelOverride;
        expect(activeModelSpec(settings({ modelOverride: stale })).key).toBe(modelKeyFor(OVERRIDE));
    });
});

describe('probeModelDownloaded', () => {
    it('matches the weight file for the spec dtype (q8 → model_quantized.onnx)', async () => {
        const f = fakeCaches([hfUrl('acme/my-embed', 'onnx/model_quantized.onnx'), hfUrl('acme/my-embed', 'config.json')]);
        expect((await probeModelDownloaded(f.cs, { repo: 'acme/my-embed', dtype: 'q8' })).downloaded).toBe(true);
        expect((await probeModelDownloaded(f.cs, { repo: 'acme/my-embed', dtype: 'q4' })).downloaded).toBe(false);
    });

    it('configs alone are not a download', async () => {
        const f = fakeCaches([hfUrl(ACTIVE_REPO, 'config.json')]);
        expect((await probeModelDownloaded(f.cs, ACTIVE_MODEL_SPEC)).downloaded).toBe(false);
    });
});

describe('shouldEvictCacheUrl', () => {
    it('keeps the active repo, evicts other HF repos', () => {
        expect(shouldEvictCacheUrl(hfUrl(ACTIVE_REPO), ACTIVE_REPO)).toBe(false);
        expect(shouldEvictCacheUrl(hfUrl(ACTIVE_REPO, 'config.json'), ACTIVE_REPO)).toBe(false);
        expect(shouldEvictCacheUrl(hfUrl('tooape/old-model'), ACTIVE_REPO)).toBe(true);
    });

    it('ignores non-HF / non-resolve URLs (jsdelivr runtime, etc.)', () => {
        expect(shouldEvictCacheUrl('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0', ACTIVE_REPO)).toBe(false);
        expect(shouldEvictCacheUrl('https://example.com/whatever', ACTIVE_REPO)).toBe(false);
    });

    it('matches the repo as a path segment (prefix-repo safety)', () => {
        // keepRepo is a prefix of another repo: the longer repo must still be evicted,
        // and the exact repo must still be kept.
        expect(shouldEvictCacheUrl(hfUrl('tooape/granite-2'), 'tooape/granite')).toBe(true);
        expect(shouldEvictCacheUrl(hfUrl('tooape/granite'), 'tooape/granite')).toBe(false);
    });
});

describe('isCacheUrlForRepo', () => {
    it('matches HF resolve URLs for the repo, ignores others', () => {
        expect(isCacheUrlForRepo(hfUrl(ACTIVE_REPO), ACTIVE_REPO)).toBe(true);
        expect(isCacheUrlForRepo(hfUrl(ACTIVE_REPO, 'config.json'), ACTIVE_REPO)).toBe(true);
        expect(isCacheUrlForRepo(hfUrl('tooape/other'), ACTIVE_REPO)).toBe(false);
        expect(isCacheUrlForRepo('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0', ACTIVE_REPO)).toBe(false);
    });

    it('is the exact inverse of shouldEvictCacheUrl for HF model URLs', () => {
        for (const url of [hfUrl(ACTIVE_REPO), hfUrl('tooape/granite-2'), hfUrl('tooape/granite')]) {
            expect(isCacheUrlForRepo(url, 'tooape/granite')).toBe(!shouldEvictCacheUrl(url, 'tooape/granite'));
        }
    });
});

// Structural CacheStorage fake — one named cache holding {url} request stand-ins.
function fakeCaches(urls: string[], present = true) {
    let reqs = urls.map(url => ({ url }));
    const cache = {
        keys: async () => reqs.slice(),
        delete: async (req: { url: string }) => {
            const before = reqs.length;
            reqs = reqs.filter(r => r.url !== req.url);
            return reqs.length < before;
        },
    };
    return {
        remaining: () => reqs.map(r => r.url),
        cs: {
            has: async () => present,
            open: async () => cache,
        } as unknown as CacheStorage,
    };
}

describe('evictStaleModelCaches', () => {
    it('deletes only stale-repo entries, keeps the active model + runtime', async () => {
        const f = fakeCaches([
            hfUrl(ACTIVE_REPO),
            hfUrl(ACTIVE_REPO, 'config.json'),
            hfUrl('tooape/old-model'),
            hfUrl('tooape/older-still', 'tokenizer.json'),
            'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0',
        ]);
        const res = await evictStaleModelCaches(f.cs, ACTIVE_REPO);
        expect(res.seen).toBe(5);
        expect(res.deleted).toBe(2);                 // two stale repos
        expect(f.remaining()).toContain(hfUrl(ACTIVE_REPO));
        expect(f.remaining()).toContain('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0');
        expect(f.remaining()).not.toContain(hfUrl('tooape/old-model'));
    });

    it('no-ops cleanly when the transformers cache is absent', async () => {
        const f = fakeCaches([], /* present */ false);
        expect(await evictStaleModelCaches(f.cs, ACTIVE_REPO)).toEqual({ seen: 0, deleted: 0 });
    });

    it('first-ever load (only active repo cached) deletes nothing', async () => {
        const f = fakeCaches([hfUrl(ACTIVE_REPO), hfUrl(ACTIVE_REPO, 'config.json')]);
        const res = await evictStaleModelCaches(f.cs, ACTIVE_REPO);
        expect(res).toEqual({ seen: 2, deleted: 0 });
    });
});

describe('deleteModelCaches', () => {
    it('deletes only the active repo, keeps other repos + runtime', async () => {
        const f = fakeCaches([
            hfUrl(ACTIVE_REPO),
            hfUrl(ACTIVE_REPO, 'config.json'),
            hfUrl('tooape/other-model'),
            'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0',
        ]);
        const res = await deleteModelCaches(f.cs, ACTIVE_REPO);
        expect(res.seen).toBe(4);
        expect(res.deleted).toBe(2);                            // both active-repo entries
        expect(f.remaining()).not.toContain(hfUrl(ACTIVE_REPO));
        expect(f.remaining()).toContain(hfUrl('tooape/other-model'));
        expect(f.remaining()).toContain('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0');
    });

    it('no-ops cleanly when the transformers cache is absent', async () => {
        const f = fakeCaches([], /* present */ false);
        expect(await deleteModelCaches(f.cs, ACTIVE_REPO)).toEqual({ seen: 0, deleted: 0 });
    });
});
