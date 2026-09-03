// The Advanced-model-settings DRAFT: the settings tab's LOCAL state for the
// user-selectable embedding model (never saved on a keystroke — the override is
// synced and drives every device's index identity, so it may only change through
// validate-then-switch) and every transition on it. Obsidian-free so the races that
// make it subtle are pinned by unit tests (model-draft.test.ts) instead of being
// re-discovered in review: a Validate result landing after the fields it validated
// were edited; a Repo blur that changed nothing; a pooling detection landing
// mid-validation; a discard (tab hidden) under an in-flight Validate.
// settings-tab.ts only PAINTS this state and forwards field events to it.

import type { SeekerSettings, ModelOverride, Pooling } from './types';
import type { ModelCandidate, ModelValidation } from './model-validate';
import { ACTIVE_MODEL_SPEC } from './model-registry';
import { isValidHfSlug, INVALID_HF_SLUG_MESSAGE } from './model-candidate';

// Hint under the Pooling dropdown after a Repo commit.
export const POOLING_DETECTED_HINT = 'Detected from the repo.';
export const POOLING_UNDECLARED_HINT = 'Not declared by the repo — pick manually.';

export interface ModelDraftDeps {
    // The active model's values, read when the draft (re)seeds — LAZILY, so a draft
    // discarded on hide() reseeds from a just-switched override on the next open.
    seed(): ModelCandidate;
    // Best-effort pooling detection from the repo's sentence-transformers config
    // (null = not declared). Must resolve, never reject.
    detectPooling(repo: string, revision: string | null): Promise<Pooling | null>;
    // The (slow, ~model-download) validation of a candidate.
    validate(c: ModelCandidate): Promise<ModelValidation>;
}

// What the owner repaints on each transition, split by what the DOM must do: `edited`
// and `repoFeedback` are painted IN PLACE (rebuilding the tab destroys the focus and
// further keystrokes of the field being typed in), while a validation transition
// (spinner ↔ result line) is structural and rebuilds.
export interface ModelDraftView {
    // A field edit (keystroke, dropdown pick, or a pooling detection landing) dropped
    // the validation: Switch must disable, a stale result line must go.
    // `switchRowWasOpen`: the edit landed under the open switch-confirm row — only a
    // detection landing can (the fields are locked then) — so that row must go too.
    onEdited(switchRowWasOpen: boolean): void;
    // repoError / poolingHint / the detected pooling changed.
    onRepoFeedback(): void;
    // `validating` flipped, or a Validate result landed.
    onValidationChanged(): void;
}

export class ModelDraft {
    // The in-progress field values, seeded lazily (see deps.seed).
    private _candidate: ModelCandidate | null = null;
    // The last Validate result; null once ANY field changes, so "Switch" is only ever
    // enabled for the exact values that were validated.
    private _validation: ModelValidation | null = null;
    private _validating = false;
    // The switch-confirm row is open (armed only from an ok validation; any edit disarms).
    private _switchArmed = false;
    private _repoError: string | null = null;
    private _poolingHint: string | null = null;
    // Generation counter for in-flight Validate calls: invalidate() bumps it, and a
    // result is only accepted when the generation it started under is still current.
    // Without it a result could land AFTER the fields it validated were edited (or the
    // draft was discarded and reseeded) and re-enable Switch for never-validated values.
    private validationSeq = 0;
    // The repo the last commit ran for. Blur fires on every focus loss, edited or not,
    // so commitRepo() only acts on a real change — otherwise clicking into the field and
    // straight onto Validate would re-run pooling detection for nothing.
    private committedRepo: string | null = null;
    // The in-flight commitRepo() (slug check + async pooling detection), if any.
    // validate() AWAITS it: the click that starts a Validate is what blurs the Repo
    // field, so the detection is nearly always still running when Validate would
    // otherwise snapshot the candidate — and a detection landing mid-validation with a
    // different pooling would invalidate that (100 MB) validation, silently.
    private pendingRepoCommit: Promise<void> | null = null;
    // Bumped by discard() ONLY. validate() re-baselines validationSeq after the Repo
    // commit await (so a detection landing during that await is honored, not treated as
    // a stale result), which would also erase a discard that landed in the same window —
    // so validate() watches this counter across that await to abort a discarded run
    // before it reseeds the dropped draft and loads (100 MB) for nothing.
    private discardSeq = 0;

    constructor(private readonly deps: ModelDraftDeps, private readonly view: ModelDraftView) {}

    // The draft's seed for a settings object: the persisted override when one is
    // active, else the shipped default's values with an EMPTY revision (so the field
    // shows its "main, pinned on Validate" placeholder, not the default's pinned sha).
    static seedFrom(settings: Pick<SeekerSettings, 'modelOverride'>): ModelCandidate {
        const o = settings.modelOverride;
        return o
            ? { repo: o.repo, revision: o.revision, pooling: o.pooling, dtype: o.dtype, queryPrefix: o.queryPrefix, docPrefix: o.docPrefix }
            : { repo: ACTIVE_MODEL_SPEC.repo, revision: null, pooling: ACTIVE_MODEL_SPEC.pooling, dtype: ACTIVE_MODEL_SPEC.dtype, queryPrefix: ACTIVE_MODEL_SPEC.queryPrefix, docPrefix: ACTIVE_MODEL_SPEC.docPrefix };
    }

    get candidate(): ModelCandidate {
        if (this._candidate === null) {
            this._candidate = this.deps.seed();
            // The seeded repo counts as committed: no detection until the user changes it.
            this.committedRepo = this._candidate.repo;
        }
        return this._candidate;
    }
    get validation(): ModelValidation | null { return this._validation; }
    get validating(): boolean { return this._validating; }
    get switchArmed(): boolean { return this._switchArmed; }
    get repoError(): string | null { return this._repoError; }
    get poolingHint(): string | null { return this._poolingHint; }

    // A field edit. Text fields pass their (trimmed) value on every keystroke.
    edit(patch: Partial<ModelCandidate>): void {
        Object.assign(this.candidate, patch);
        this.edited();
    }

    // A manual pooling pick supersedes the detection hint (it no longer describes the value).
    pickPooling(p: Pooling): void {
        this.candidate.pooling = p;
        this._poolingHint = null;
        this.view.onRepoFeedback();
        this.edited();
    }

    // Blur/Enter on the Repo field: validate the slug shape (inline error) and, on a
    // good slug, best-effort detect pooling from the repo to prefill the dropdown + hint.
    commitRepo(): Promise<void> {
        this.pendingRepoCommit = this.runRepoCommit();
        return this.pendingRepoCommit;
    }

    private async runRepoCommit(): Promise<void> {
        const c = this.candidate;
        const repo = c.repo;
        // Unchanged since the last commit (blur without an edit): nothing to do. The
        // keystroke edit() already invalidated any validation for a real change.
        if (repo === this.committedRepo) return;
        this.committedRepo = repo;
        if (repo === '') {
            this._repoError = null; this._poolingHint = null;
            this.view.onRepoFeedback();
            return;
        }
        if (!isValidHfSlug(repo)) {
            this._repoError = INVALID_HF_SLUG_MESSAGE;
            this._poolingHint = null;
            this.view.onRepoFeedback();
            return;
        }
        this._repoError = null;
        this.view.onRepoFeedback();
        const detected = await this.deps.detectPooling(repo, c.revision);
        // The draft may have moved on while the fetch was in flight (the user kept
        // typing, or the draft was discarded — read the raw field, a reseed here would
        // be a side effect): only apply the detection if this is still the current repo.
        if (this._candidate?.repo !== repo) return;
        this._poolingHint = detected ? POOLING_DETECTED_HINT : POOLING_UNDECLARED_HINT;
        // Applying a DIFFERENT pooling is a field edit like any other: it must invalidate
        // a Validate that ran (or is still running) with the old value.
        const changed = detected !== null && this._candidate.pooling !== detected;
        if (detected) this._candidate.pooling = detected;
        this.view.onRepoFeedback();
        if (changed) this.edited();
    }

    async validate(): Promise<void> {
        this._validating = true;
        this.view.onValidationChanged();
        // Let the Repo commit this click just triggered (blur → pooling detection) land
        // FIRST, so the snapshot below carries the detected pooling instead of being
        // invalidated by it seconds later (see pendingRepoCommit). Best-effort: detection
        // never rejects, but a rejection here must not leave `validating` stuck true.
        const discardAtStart = this.discardSeq;
        try { await this.pendingRepoCommit; } catch { /* the validator re-checks the slug */ }
        // Discarded (tab hidden) while we waited for the commit: abort before the
        // invalidate() below re-baselines the generation and hides the discard. Reading
        // `this.candidate` now would reseed the dropped draft and load its bytes.
        if (this.discardSeq !== discardAtStart) {
            this._validating = false;
            this.view.onValidationChanged();
            return;
        }
        this.invalidate();
        const seq = this.validationSeq;
        let result: ModelValidation;
        try {
            result = await this.deps.validate({ ...this.candidate });
        } catch (e) {
            result = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        // Only accept the result if nothing invalidated it while it ran (an edit, a
        // pooling detection landing, a discard); a discarded result just leaves the
        // user with no result line, and Switch stays disabled until they Validate again.
        if (seq === this.validationSeq) this._validation = result;
        this._validating = false;
        this.view.onValidationChanged();
    }

    // Open the switch-confirm row. False (nothing happens) unless the current values
    // validated ok.
    armSwitch(): boolean {
        if (!this._validation?.ok) return false;
        this._switchArmed = true;
        return true;
    }
    disarmSwitch(): void { this._switchArmed = false; }

    // The override the confirm row commits: EXACTLY the validated values (measured dim,
    // pinned revision), read at CLICK time — never from a render-time closure. Null when
    // the row isn't armed or the state was invalidated under it (a late detection).
    switchPayload(): ModelOverride | null {
        const v = this._validation;
        if (!this._switchArmed || !v?.ok) return null;
        return { ...this.candidate, dim: v.dim, revision: v.revision };
    }

    // Drop the draft + everything derived from it (validation, armed switch, repo commit
    // state) so the next `candidate` read reseeds from the active model. `validating`
    // is deliberately kept: an in-flight Validate is still running (its result is
    // discarded by the generation bump), and a second one must not start beside it.
    discard(): void {
        this._candidate = null;
        this.committedRepo = null;
        this.pendingRepoCommit = null;
        this._repoError = null;
        this._poolingHint = null;
        this.discardSeq++;
        this.invalidate();
    }

    // Any field edit invalidates a prior Validate result and drops out of the switch
    // confirm. Bumping the generation also discards any Validate still in flight.
    private edited(): void {
        const wasArmed = this._switchArmed;
        this.invalidate();
        this.view.onEdited(wasArmed);
    }

    private invalidate(): void {
        this.validationSeq++;
        this._validation = null;
        this._switchArmed = false;
    }
}
