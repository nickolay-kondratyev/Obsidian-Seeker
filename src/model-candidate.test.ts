// Unit tests for the pure candidate helpers (slug shape, HF URLs, revision-sha +
// pooling-config parsers, probe-vector check, load-error copy). All total functions
// over plain data — no DOM, iframe, or network.

import { describe, it, expect } from 'vitest';
import {
    isValidHfSlug,
    poolingConfigUrl,
    revisionInfoUrl,
    parseRevisionSha,
    parsePoolingConfig,
    PROBE_SENTENCE,
    checkProbeVector,
    describeModelLoadError,
} from './model-candidate';

describe('isValidHfSlug', () => {
    const accepted = [
        'sentence-transformers/all-MiniLM-L6-v2',
        'owner/name',
        'a/b',
        'BAAI/bge-small-en-v1.5',
        'org.name/model_1',
        '  owner/name  ', // trimmed
    ];
    for (const s of accepted) {
        it(`accepts ${JSON.stringify(s)}`, () => {
            expect(isValidHfSlug(s)).toBe(true);
        });
    }

    const rejected = [
        ['a URL', 'https://huggingface.co/owner/name'],
        ['a bare host path', 'huggingface.co/owner/name'],
        ['a space in the name', 'owner/na me'],
        ['a missing owner', 'name'],
        ['a trailing slash only', 'owner/'],
        ['a leading dot', '.owner/name'],
        ['a leading dot on the name', 'owner/.name'],
        ['an empty string', ''],
        ['two slashes', 'owner/sub/name'],
    ] as const;
    for (const [why, s] of rejected) {
        it(`rejects ${why}: ${JSON.stringify(s)}`, () => {
            expect(isValidHfSlug(s)).toBe(false);
        });
    }
});

describe('poolingConfigUrl', () => {
    it('pins the given revision', () => {
        expect(poolingConfigUrl('owner/name', 'abc123'))
            .toBe('https://huggingface.co/owner/name/resolve/abc123/1_Pooling/config.json');
    });
    it('falls back to main when the revision is null', () => {
        expect(poolingConfigUrl('owner/name', null))
            .toBe('https://huggingface.co/owner/name/resolve/main/1_Pooling/config.json');
    });
});

describe('revisionInfoUrl', () => {
    it('targets the HF Hub revision API for the given revision', () => {
        expect(revisionInfoUrl('owner/name', 'v1.0'))
            .toBe('https://huggingface.co/api/models/owner/name/revision/v1.0');
    });
    it('falls back to main when the revision is null', () => {
        expect(revisionInfoUrl('owner/name', null))
            .toBe('https://huggingface.co/api/models/owner/name/revision/main');
    });
});

describe('parseRevisionSha', () => {
    const validSha = '54db88c5667bd79b4aea24ea6027a7ef45a7bbb5';
    it('returns a 40-char lowercase hex sha', () => {
        expect(parseRevisionSha({ sha: validSha })).toBe(validSha);
    });
    it('returns null when sha is missing', () => {
        expect(parseRevisionSha({ modelId: 'owner/name' })).toBeNull();
    });
    it('returns null for a short sha', () => {
        expect(parseRevisionSha({ sha: 'abc123' })).toBeNull();
    });
    it('returns null for an uppercase sha', () => {
        expect(parseRevisionSha({ sha: validSha.toUpperCase() })).toBeNull();
    });
    it('returns null for a non-string sha', () => {
        expect(parseRevisionSha({ sha: 12345 })).toBeNull();
    });
    it('returns null for a non-object', () => {
        expect(parseRevisionSha('not json')).toBeNull();
        expect(parseRevisionSha(null)).toBeNull();
    });
});

describe('parsePoolingConfig', () => {
    it('maps cls-token true to cls', () => {
        expect(parsePoolingConfig({ pooling_mode_cls_token: true })).toBe('cls');
    });
    it('maps mean-tokens true to mean', () => {
        expect(parsePoolingConfig({ pooling_mode_mean_tokens: true })).toBe('mean');
    });
    it('resolves both-true deterministically to cls (checked first)', () => {
        expect(parsePoolingConfig({ pooling_mode_cls_token: true, pooling_mode_mean_tokens: true })).toBe('cls');
    });
    it('returns null when neither flag is true', () => {
        expect(parsePoolingConfig({ pooling_mode_cls_token: false, pooling_mode_mean_tokens: false })).toBeNull();
    });
    it('returns null for a non-object', () => {
        expect(parsePoolingConfig(null)).toBeNull();
        expect(parsePoolingConfig(42)).toBeNull();
    });
});

describe('checkProbeVector', () => {
    // A unit vector: [0.6, 0.8] has norm 1.0 exactly.
    it('accepts a unit-norm vector (null = ok)', () => {
        expect(checkProbeVector(new Float32Array([0.6, 0.8]))).toBeNull();
    });
    it('accepts a vector within the 1e-2 tolerance', () => {
        expect(checkProbeVector(new Float32Array([0.6, 0.805]))).toBeNull();
    });
    it('rejects an empty vector', () => {
        expect(checkProbeVector(new Float32Array([]))).toMatch(/empty/);
    });
    it('rejects a non-finite vector', () => {
        expect(checkProbeVector(new Float32Array([NaN, 1]))).toMatch(/non-finite/);
        expect(checkProbeVector(new Float32Array([Infinity, 0]))).toMatch(/non-finite/);
    });
    it('rejects a vector that is not unit-normalized', () => {
        expect(checkProbeVector(new Float32Array([3, 4]))).toMatch(/not unit-normalized/);
    });
});

describe('describeModelLoadError', () => {
    it('maps a 404 to a dtype hint and appends the raw error', () => {
        const msg = describeModelLoadError('Error: 404 for onnx/model_q4.onnx');
        expect(msg).toMatch(/dtype/i);
        expect(msg).toContain('(Error: 404 for onnx/model_q4.onnx)');
    });
    it('maps a 403 to a gated/private repo message', () => {
        expect(describeModelLoadError('Request failed with status 403')).toMatch(/private or gated/i);
    });
    it('maps a 401 to a gated/private repo message', () => {
        expect(describeModelLoadError('401 Unauthorized')).toMatch(/private or gated/i);
    });
    it('maps a network failure to an offline message', () => {
        expect(describeModelLoadError('TypeError: Failed to fetch')).toMatch(/network/i);
    });
    it('falls back to a generic message and still appends the raw error', () => {
        const msg = describeModelLoadError('some weird internal error');
        expect(msg).toMatch(/failed to load/i);
        expect(msg).toContain('(some weird internal error)');
    });
});

describe('PROBE_SENTENCE', () => {
    it('is a non-trivial sentence so pooling runs over several tokens', () => {
        expect(PROBE_SENTENCE.split(/\s+/).length).toBeGreaterThan(3);
    });
});
