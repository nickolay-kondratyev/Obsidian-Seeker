// Unit tests for the Advanced-model-settings draft (ModelDraft): the tab-local state
// machine behind Repo/Revision/Pooling/Precision/prefix edits, Validate and Switch.
// Detection and validation are Deferreds the test resolves by hand, so every race
// the class exists to close is deterministic: a Validate result landing after an
// edit / a discard, a stale detection, a detection landing mid-validation, and
// Validate waiting for the Repo commit its own click triggered.

import { describe, it, expect } from 'vitest';
import { ModelDraft, POOLING_DETECTED_HINT, POOLING_UNDECLARED_HINT, type ModelDraftDeps } from './model-draft';
import { INVALID_HF_SLUG_MESSAGE } from './model-candidate';
import { ACTIVE_MODEL_SPEC } from './model-registry';
import type { ModelCandidate, ModelValidation } from './model-validate';
import type { ModelOverride, Pooling } from './types';

const SHA = '54db88c5667bd79b4aea24ea6027a7ef45a7bbb5';
const SEED: ModelCandidate = { repo: 'owner/seeded', revision: null, pooling: 'cls', dtype: 'q4', queryPrefix: '', docPrefix: '' };
const OK: ModelValidation = { ok: true, dim: 768, dtype: 'q8', device: 'wasm', revision: SHA };

class Deferred<T> {
    readonly promise: Promise<T>;
    resolve!: (v: T) => void;
    reject!: (e: unknown) => void;
    constructor() {
        this.promise = new Promise<T>((res, rej) => { this.resolve = res; this.reject = rej; });
    }
}

// Let every queued continuation run (a resolved Deferred's `await` resumes on a
// microtask; a macrotask turn flushes them all).
const settle = () => new Promise<void>(r => setTimeout(r, 0));

// A draft over a recording view + hand-resolved deps.
function harness(seed: ModelCandidate = SEED) {
    const events: string[] = [];
    let seeds = 0;
    const detections: Array<{ repo: string; revision: string | null; d: Deferred<Pooling | null> }> = [];
    const validations: Array<{ c: ModelCandidate; d: Deferred<ModelValidation> }> = [];
    const deps: ModelDraftDeps = {
        seed: () => { seeds++; return { ...seed }; },
        detectPooling: (repo, revision) => {
            const d = new Deferred<Pooling | null>();
            detections.push({ repo, revision, d });
            return d.promise;
        },
        validate: (c) => {
            const d = new Deferred<ModelValidation>();
            validations.push({ c, d });
            return d.promise;
        },
    };
    const draft = new ModelDraft(deps, {
        onEdited: (switchRowWasOpen) => events.push(`edited:${switchRowWasOpen}`),
        onRepoFeedback: () => events.push('repoFeedback'),
        onValidationChanged: () => events.push('validation'),
    });
    return { draft, events, detections, validations, seedCount: () => seeds };
}

// Drive a draft to an ok validation for its current values.
async function validated(h: ReturnType<typeof harness>): Promise<void> {
    const run = h.draft.validate();
    await settle();
    h.validations[h.validations.length - 1].d.resolve(OK);
    await run;
    h.events.length = 0;
}

describe('ModelDraft.seedFrom', () => {
    it('copies an active override field-by-field (dim is not part of a candidate)', () => {
        const o: ModelOverride = { repo: 'me/model', revision: SHA, dim: 512, pooling: 'mean', dtype: 'fp32', queryPrefix: 'q: ', docPrefix: 'p: ' };
        expect(ModelDraft.seedFrom({ modelOverride: o })).toEqual({
            repo: 'me/model', revision: SHA, pooling: 'mean', dtype: 'fp32', queryPrefix: 'q: ', docPrefix: 'p: ',
        });
    });

    it('seeds the shipped default with an EMPTY revision when no override is active', () => {
        expect(ModelDraft.seedFrom({})).toEqual({
            repo: ACTIVE_MODEL_SPEC.repo, revision: null, pooling: ACTIVE_MODEL_SPEC.pooling,
            dtype: ACTIVE_MODEL_SPEC.dtype, queryPrefix: ACTIVE_MODEL_SPEC.queryPrefix, docPrefix: ACTIVE_MODEL_SPEC.docPrefix,
        });
    });
});

describe('ModelDraft candidate + edits', () => {
    it('seeds lazily, once, and hands back the same object on every read', () => {
        const h = harness();
        expect(h.seedCount()).toBe(0);
        const c = h.draft.candidate;
        expect(c).toEqual(SEED);
        expect(h.draft.candidate).toBe(c);
        expect(h.seedCount()).toBe(1);
    });

    it('edit() patches the candidate and reports the edit with the switch row closed', () => {
        const h = harness();
        h.draft.edit({ queryPrefix: 'query: ' });
        expect(h.draft.candidate.queryPrefix).toBe('query: ');
        expect(h.events).toEqual(['edited:false']);
    });

    it('an edit drops an ok validation', async () => {
        const h = harness();
        await validated(h);
        expect(h.draft.validation).toEqual(OK);
        h.draft.edit({ dtype: 'q8' });
        expect(h.draft.validation).toBeNull();
    });

    it('an edit under the open switch row disarms it and says so', async () => {
        const h = harness();
        await validated(h);
        expect(h.draft.armSwitch()).toBe(true);
        h.draft.edit({ dtype: 'q8' });
        expect(h.draft.switchArmed).toBe(false);
        expect(h.events).toEqual(['edited:true']);
    });

    it('pickPooling() applies the pick, drops the detection hint, then counts as an edit', async () => {
        const h = harness();
        h.draft.edit({ repo: 'owner/other' });
        void h.draft.commitRepo();
        h.detections[0].d.resolve('mean');
        await settle();
        expect(h.draft.poolingHint).toBe(POOLING_DETECTED_HINT);
        h.events.length = 0;

        h.draft.pickPooling('cls');
        expect(h.draft.candidate.pooling).toBe('cls');
        expect(h.draft.poolingHint).toBeNull();
        expect(h.events).toEqual(['repoFeedback', 'edited:false']);
    });
});

describe('ModelDraft.commitRepo', () => {
    it('an unchanged repo (blur without an edit) does nothing — no detection, no paint', async () => {
        const h = harness();
        await h.draft.commitRepo();
        expect(h.detections).toHaveLength(0);
        expect(h.events).toEqual([]);
    });

    it('a malformed slug paints the shared error and never hits detection', async () => {
        const h = harness();
        h.draft.edit({ repo: 'not a slug' });
        await h.draft.commitRepo();
        expect(h.draft.repoError).toBe(INVALID_HF_SLUG_MESSAGE);
        expect(h.detections).toHaveLength(0);
        expect(h.events).toEqual(['edited:false', 'repoFeedback']);
    });

    it('an emptied repo clears the error without detection', async () => {
        const h = harness();
        h.draft.edit({ repo: 'not a slug' });
        await h.draft.commitRepo();
        h.draft.edit({ repo: '' });
        await h.draft.commitRepo();
        expect(h.draft.repoError).toBeNull();
        expect(h.detections).toHaveLength(0);
    });

    it('a good slug clears the error, detects with the typed revision, and applies a different pooling as an edit', async () => {
        const h = harness();
        h.draft.edit({ repo: 'not a slug' });
        await h.draft.commitRepo();
        h.draft.edit({ revision: 'v2' });
        h.draft.edit({ repo: 'owner/other' });
        const commit = h.draft.commitRepo();
        expect(h.draft.repoError).toBeNull();
        expect(h.detections).toEqual([expect.objectContaining({ repo: 'owner/other', revision: 'v2' })]);
        h.events.length = 0;

        h.detections[0].d.resolve('mean');
        await commit;
        expect(h.draft.candidate.pooling).toBe('mean');
        expect(h.draft.poolingHint).toBe(POOLING_DETECTED_HINT);
        expect(h.events).toEqual(['repoFeedback', 'edited:false']);
    });

    it('a detection matching the current pooling paints the hint but is NOT an edit', async () => {
        const h = harness();
        h.draft.edit({ repo: 'owner/other' });
        const commit = h.draft.commitRepo();
        h.events.length = 0;
        h.detections[0].d.resolve('cls');
        await commit;
        expect(h.draft.poolingHint).toBe(POOLING_DETECTED_HINT);
        expect(h.events).toEqual(['repoFeedback']);
    });

    it('an undeclared pooling leaves the value alone and asks for a manual pick', async () => {
        const h = harness();
        h.draft.edit({ repo: 'owner/other' });
        const commit = h.draft.commitRepo();
        h.events.length = 0;
        h.detections[0].d.resolve(null);
        await commit;
        expect(h.draft.candidate.pooling).toBe('cls');
        expect(h.draft.poolingHint).toBe(POOLING_UNDECLARED_HINT);
        expect(h.events).toEqual(['repoFeedback']);
    });

    it('a detection for a repo the user has since replaced is ignored', async () => {
        const h = harness();
        h.draft.edit({ repo: 'owner/first' });
        const first = h.draft.commitRepo();
        h.draft.edit({ repo: 'owner/second' });
        void h.draft.commitRepo();
        h.events.length = 0;

        h.detections[0].d.resolve('mean');
        await first;
        expect(h.draft.candidate.pooling).toBe('cls');
        expect(h.draft.poolingHint).toBeNull();
        expect(h.events).toEqual([]);
    });

    it('a detection landing after discard() is ignored and does not reseed', async () => {
        const h = harness();
        h.draft.edit({ repo: 'owner/other' });
        const commit = h.draft.commitRepo();
        h.draft.discard();
        const seedsBefore = h.seedCount();
        h.events.length = 0;

        h.detections[0].d.resolve('mean');
        await commit;
        expect(h.seedCount()).toBe(seedsBefore);
        expect(h.events).toEqual([]);
        expect(h.draft.candidate.pooling).toBe('cls');
    });
});

describe('ModelDraft.validate', () => {
    it('flips validating around the call, validates a SNAPSHOT, and keeps the result', async () => {
        const h = harness();
        const run = h.draft.validate();
        expect(h.draft.validating).toBe(true);
        await settle();
        expect(h.validations[0].c).toEqual(SEED);
        expect(h.validations[0].c).not.toBe(h.draft.candidate);

        h.validations[0].d.resolve(OK);
        await run;
        expect(h.draft.validating).toBe(false);
        expect(h.draft.validation).toEqual(OK);
        expect(h.events).toEqual(['validation', 'validation']);
    });

    it('a rejected validation becomes a plain error result', async () => {
        const h = harness();
        const run = h.draft.validate();
        await settle();
        h.validations[0].d.reject(new Error('boom'));
        await run;
        expect(h.draft.validation).toEqual({ ok: false, error: 'boom' });
        expect(h.draft.validating).toBe(false);
    });

    it('a result landing after an edit is discarded — Switch cannot arm for unvalidated values', async () => {
        const h = harness();
        const run = h.draft.validate();
        await settle();
        h.draft.edit({ docPrefix: 'passage: ' });
        h.validations[0].d.resolve(OK);
        await run;
        expect(h.draft.validation).toBeNull();
        expect(h.draft.armSwitch()).toBe(false);
        expect(h.draft.validating).toBe(false);
    });

    it('a result landing after discard() is discarded, and validating still settles', async () => {
        const h = harness();
        const run = h.draft.validate();
        await settle();
        h.draft.discard();
        expect(h.draft.validating).toBe(true);
        h.validations[0].d.resolve(OK);
        await run;
        expect(h.draft.validation).toBeNull();
        expect(h.draft.validating).toBe(false);
    });

    it('waits for the in-flight Repo commit so the snapshot carries the detected pooling and the result is kept', async () => {
        const h = harness();
        h.draft.edit({ repo: 'owner/other' });
        void h.draft.commitRepo();          // the blur the Validate click triggers
        const run = h.draft.validate();
        await settle();
        expect(h.validations).toHaveLength(0);   // still waiting on the detection

        h.detections[0].d.resolve('mean');
        await settle();
        expect(h.validations[0].c.pooling).toBe('mean');
        h.validations[0].d.resolve(OK);
        await run;
        expect(h.draft.validation).toEqual(OK);
    });

    it('a detection that changes pooling mid-validation drops that result', async () => {
        const h = harness();
        const run = h.draft.validate();
        await settle();
        h.draft.edit({ repo: 'owner/other' });
        const commit = h.draft.commitRepo();
        h.detections[0].d.resolve('mean');
        await commit;
        h.validations[0].d.resolve(OK);
        await run;
        expect(h.draft.validation).toBeNull();
    });
});

describe('ModelDraft switch arming + payload', () => {
    it('cannot arm without an ok validation', async () => {
        const h = harness();
        expect(h.draft.armSwitch()).toBe(false);
        const run = h.draft.validate();
        await settle();
        h.validations[0].d.resolve({ ok: false, error: 'nope' });
        await run;
        expect(h.draft.armSwitch()).toBe(false);
        expect(h.draft.switchPayload()).toBeNull();
    });

    it('the payload is the candidate plus the MEASURED dim and PINNED revision, only while armed', async () => {
        const h = harness();
        h.draft.edit({ revision: 'main' });
        await validated(h);
        expect(h.draft.switchPayload()).toBeNull();
        h.draft.armSwitch();
        expect(h.draft.switchPayload()).toEqual({ ...SEED, revision: SHA, dim: 768 });
        h.draft.disarmSwitch();
        expect(h.draft.switchPayload()).toBeNull();
    });

    it('an edit under the armed row voids the payload', async () => {
        const h = harness();
        await validated(h);
        h.draft.armSwitch();
        h.draft.edit({ docPrefix: 'x' });
        expect(h.draft.switchPayload()).toBeNull();
    });
});

describe('ModelDraft.discard', () => {
    it('reseeds from deps on the next read and clears validation, arming and repo feedback', async () => {
        const h = harness();
        h.draft.edit({ repo: 'not a slug' });
        await h.draft.commitRepo();
        await validated(h);
        h.draft.armSwitch();

        h.draft.discard();
        expect(h.draft.validation).toBeNull();
        expect(h.draft.switchArmed).toBe(false);
        expect(h.draft.repoError).toBeNull();
        expect(h.draft.candidate).toEqual(SEED);
        expect(h.seedCount()).toBe(2);
    });
});
