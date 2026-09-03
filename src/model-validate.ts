// Validate-then-switch ORCHESTRATION, kept Obsidian-free so it can be unit-tested
// with a stub embedder + stub revision resolver — no Plugin, no iframe, no network
// (ticket 5/6, plan "Validate → Switch"). main.ts supplies the real dependencies:
// `() => new LocalEmbedder()` and `this.resolveRevisionSha`. The pure per-step
// helpers (slug shape, probe check, error copy) live in src/model-candidate.ts.

import type { Device, Dtype, RequestedDevice, ModelOverride } from './types';
import type { LocalEmbedder } from './embedder';
import { modelKeyFor } from './model-registry';
import { isValidHfSlug, PROBE_SENTENCE, checkProbeVector, describeModelLoadError } from './model-candidate';

// A candidate model = a would-be ModelOverride minus `dim` (dim is what validation
// MEASURES, so it can't be an input). repo/revision/pooling/dtype/prefixes all come
// from the user's Advanced-model-settings fields.
export type ModelCandidate = Omit<ModelOverride, 'dim'>;

// The slice of LocalEmbedder the validator drives. A THROWAWAY LocalEmbedder is a
// full CandidateEmbedder; the narrow type is what makes the unit tests' stub trivial.
export type CandidateEmbedder = Pick<LocalEmbedder, 'load' | 'embed' | 'dim' | 'dtype' | 'device' | 'teardown'>;

// The validation outcome. On success it carries everything the switch must persist:
// the measured `dim`, the resolved `dtype`/`device` (what the load actually ran as),
// and `revision` — the PINNED 40-char sha the override stores so every device on
// every day loads identical bytes (plan decision 2026-09-03: an override never
// tracks `main`). On failure, a single plain-language `error` for the UI.
export type ModelValidation =
    | { ok: true; dim: number; dtype: Dtype; device: Device; revision: string }
    | { ok: false; error: string };

export class ModelCandidateValidator {
    constructor(
        // A FRESH embedder per validation (its own iframe — two LocalEmbedders coexist
        // because IframeRunner's IFRAME_ID is cosmetic and each filters messages by its
        // own contentWindow). Never the active embedder: validation must not disturb it.
        private readonly newEmbedder: () => CandidateEmbedder,
        // Resolve a repo + user-typed revision (branch/tag/sha, or null = branch head)
        // to an immutable commit sha, or null when unresolvable (offline / no such
        // repo|branch). A sha resolves to itself.
        private readonly resolveRevision: (repo: string, revision: string | null) => Promise<string | null>,
    ) {}

    async validate(c: ModelCandidate, device: RequestedDevice): Promise<ModelValidation> {
        // (1) Shape gate first — cheap, and it keeps a garbage slug from ever
        // constructing an embedder or hitting the network.
        if (!isValidHfSlug(c.repo)) {
            return { ok: false, error: 'Not a valid Hugging Face model id — use owner/name (e.g. sentence-transformers/all-MiniLM-L6-v2).' };
        }
        // (2) Pin the revision BEFORE any load: a model we can't pin is a model we
        // can't reproduce across devices, so there's no point loading its bytes.
        const sha = await this.resolveRevision(c.repo, c.revision);
        if (sha === null) {
            return { ok: false, error: 'Could not resolve the model revision on Hugging Face (offline, or the repo/branch does not exist).' };
        }
        // (3) Load + probe in a throwaway embedder. Loading BY the resolved sha means
        // the bytes we validate are exactly the bytes the switch will pin (dim: null =
        // detect the width, don't check it). teardown() runs on every path, incl. throw.
        const e = this.newEmbedder();
        try {
            await e.load({ ...c, revision: sha, key: modelKeyFor(c), dim: null }, device);
            const { vector } = await e.embed(PROBE_SENTENCE);
            const reason = checkProbeVector(vector);
            if (reason !== null) return { ok: false, error: reason };
            return { ok: true, dim: e.dim, dtype: e.dtype, device: e.device, revision: sha };
        } catch (err) {
            return { ok: false, error: describeModelLoadError(String(err)) };
        } finally {
            e.teardown();
        }
    }
}
