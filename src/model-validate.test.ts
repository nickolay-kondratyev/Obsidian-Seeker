// Unit tests for the validate ORCHESTRATION (ModelCandidateValidator) with a stub
// CandidateEmbedder + stub resolveRevision — no iframe, no network. Covers the happy
// path, an unresolvable revision (no embedder constructed), a load rejection, a bad
// probe vector, teardown-on-every-path, and an invalid slug short-circuit.

import { describe, it, expect } from 'vitest';
import { ModelCandidateValidator, type CandidateEmbedder, type ModelCandidate } from './model-validate';
import { modelKeyFor } from './model-registry';
import type { ModelLoadSpec } from './model-registry';
import type { Device, Dtype, RequestedDevice } from './types';
import type { LoadEntry } from './types';
import type { EmbedTimed } from './embedder';

const SHA = '54db88c5667bd79b4aea24ea6027a7ef45a7bbb5';
const UNIT_VECTOR = new Float32Array([0.6, 0.8]); // norm 1.0

const CANDIDATE: ModelCandidate = {
    repo: 'owner/name', revision: null, pooling: 'mean', dtype: 'q8', queryPrefix: '', docPrefix: '',
};

class StubEmbedder implements CandidateEmbedder {
    loadCalls: ModelLoadSpec[] = [];
    tornDown = 0;
    dim = 768;
    dtype: Dtype = 'q4';   // the RESOLVED dtype (what the load ran as), != CANDIDATE.dtype
    device: Device = 'webgpu';

    constructor(private readonly opts: { vector?: Float32Array; loadError?: unknown; embedError?: unknown } = {}) {}

    async load(spec: ModelLoadSpec, _requested: RequestedDevice): Promise<LoadEntry> {
        this.loadCalls.push(spec);
        if (this.opts.loadError !== undefined) throw this.opts.loadError;
        return {} as LoadEntry;
    }
    async embed(_text: string): Promise<EmbedTimed> {
        if (this.opts.embedError !== undefined) throw this.opts.embedError;
        return { vector: this.opts.vector ?? UNIT_VECTOR, iframeLatencyMs: 0 };
    }
    teardown(): void { this.tornDown++; }
}

// Build a validator whose factory records every embedder it constructs and whose
// resolver records every call, so a test can assert "no embedder was built".
function harness(opts: {
    embedder?: StubEmbedder;
    resolveTo?: string | null;
} = {}) {
    const built: StubEmbedder[] = [];
    const resolveCalls: Array<{ repo: string; revision: string | null }> = [];
    const validator = new ModelCandidateValidator(
        () => { const e = opts.embedder ?? new StubEmbedder(); built.push(e); return e; },
        async (repo, revision) => { resolveCalls.push({ repo, revision }); return opts.resolveTo === undefined ? SHA : opts.resolveTo; },
    );
    return { validator, built, resolveCalls };
}

describe('ModelCandidateValidator.validate', () => {
    it('happy path returns the stub dim/dtype/device and the resolved sha', async () => {
        const embedder = new StubEmbedder();
        const { validator } = harness({ embedder });
        const r = await validator.validate(CANDIDATE, 'auto');
        expect(r).toEqual({ ok: true, dim: 768, dtype: 'q4', device: 'webgpu', revision: SHA });
    });

    it('loads BY the resolved sha (with dim null and the computed key)', async () => {
        const embedder = new StubEmbedder();
        const { validator } = harness({ embedder });
        await validator.validate(CANDIDATE, 'auto');
        expect(embedder.loadCalls).toHaveLength(1);
        expect(embedder.loadCalls[0].revision).toBe(SHA);
        expect(embedder.loadCalls[0].dim).toBeNull();
        expect(embedder.loadCalls[0].key).toBe(modelKeyFor(CANDIDATE));
    });

    it('tears down the embedder on the happy path', async () => {
        const embedder = new StubEmbedder();
        const { validator } = harness({ embedder });
        await validator.validate(CANDIDATE, 'auto');
        expect(embedder.tornDown).toBe(1);
    });

    it('an unresolvable revision fails WITHOUT constructing an embedder', async () => {
        const { validator, built, resolveCalls } = harness({ resolveTo: null });
        const r = await validator.validate(CANDIDATE, 'auto');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/resolve the model revision/i);
        expect(built).toHaveLength(0);
        expect(resolveCalls).toHaveLength(1);
    });

    it('a load rejection fails with the described error and still tears down', async () => {
        const embedder = new StubEmbedder({ loadError: new Error('Request failed with status 403') });
        const { validator } = harness({ embedder });
        const r = await validator.validate(CANDIDATE, 'auto');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/private or gated/i);
        expect(embedder.tornDown).toBe(1);
    });

    it('a bad probe vector fails and still tears down', async () => {
        const embedder = new StubEmbedder({ vector: new Float32Array([3, 4]) }); // norm 5, not unit
        const { validator } = harness({ embedder });
        const r = await validator.validate(CANDIDATE, 'auto');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/not unit-normalized/i);
        expect(embedder.tornDown).toBe(1);
    });

    it('an invalid slug fails WITHOUT constructing an embedder or resolving a revision', async () => {
        const { validator, built, resolveCalls } = harness();
        const r = await validator.validate({ ...CANDIDATE, repo: 'https://huggingface.co/owner/name' }, 'auto');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/valid Hugging Face model id/i);
        expect(built).toHaveLength(0);
        expect(resolveCalls).toHaveLength(0);
    });
});
