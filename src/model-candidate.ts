// Pure, Obsidian-free helpers for validating a user-typed embedding-model
// candidate (ticket 5/6, plan "Validate → Switch"). Everything here is a total
// function over plain data so it can be unit-tested without a Plugin, an iframe,
// or the network — the orchestration that actually fetches / loads lives in
// src/model-validate.ts (the validator) and src/main.ts (the thin wiring).

import type { Pooling } from './types';

// HF hub id shape: `owner/name`, each segment starting alphanumeric then
// [A-Za-z0-9._-]*. Rejects URLs (the `:` in `https://` never matches), spaces,
// a missing owner (no `/`), and a leading dot. This is a SHAPE gate only — a
// well-formed slug that doesn't exist on the Hub still fails later at resolve/load.
const HF_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidHfSlug(s: string): boolean {
    return HF_SLUG_RE.test(s.trim());
}

// The HF resolve URL for a repo's sentence-transformers pooling config. `main`
// when no revision is pinned (the branch head). transformers.js caches model
// files under the resolve URL too, so this mirrors the load base.
export function poolingConfigUrl(repo: string, revision: string | null): string {
    return `https://huggingface.co/${repo}/resolve/${revision ?? 'main'}/1_Pooling/config.json`;
}

// The HF Hub API URL whose JSON carries a top-level `sha` = the commit the branch/
// tag/sha resolves to. Used to PIN an override to an immutable commit (plan
// decision 2026-09-03: an override never tracks `main`).
export function revisionInfoUrl(repo: string, revision: string | null): string {
    return `https://huggingface.co/api/models/${repo}/revision/${revision ?? 'main'}`;
}

// A resolved commit is a 40-char lowercase hex sha (git object id). Anything else
// — missing, short, uppercase, non-string — is not a commit we can pin.
const SHA_RE = /^[0-9a-f]{40}$/;

// Extract the resolved commit sha from the HF revision-info JSON, or null when the
// payload doesn't carry a well-formed one. Pure — the caller (main.resolveRevisionSha)
// owns the fetch and its own error/timeout handling.
export function parseRevisionSha(json: unknown): string | null {
    if (typeof json !== 'object' || json === null) return null;
    const sha = (json as { sha?: unknown }).sha;
    return typeof sha === 'string' && SHA_RE.test(sha) ? sha : null;
}

// Map a sentence-transformers 1_Pooling/config.json to our Pooling enum: the
// truth flags `pooling_mode_cls_token` / `pooling_mode_mean_tokens`. CLS is
// checked first so a (malformed) both-true config resolves deterministically to
// 'cls'; a config that declares neither (or isn't an object) yields null so the
// UI can say "not declared — pick manually" rather than guessing wrong.
export function parsePoolingConfig(json: unknown): Pooling | null {
    if (typeof json !== 'object' || json === null) return null;
    const c = json as { pooling_mode_cls_token?: unknown; pooling_mode_mean_tokens?: unknown };
    if (c.pooling_mode_cls_token === true) return 'cls';
    if (c.pooling_mode_mean_tokens === true) return 'mean';
    return null;
}

// The fixed text a validation load embeds to prove the model produces a sane
// vector. Content is irrelevant (we only check the vector's shape/norm), but it
// must be non-trivial so pooling actually runs over several tokens.
export const PROBE_SENTENCE = 'The quick brown fox jumps over the lazy dog.';

// Half-tolerance on the unit-norm check: sentence-transformers models L2-normalize
// their output, so a healthy probe vector's norm is ~1.0. A norm far off 1 means the
// wrong pooling/graph (or a numeric fault) — degraded ranking rather than a hard fail,
// which is exactly what Validate exists to catch before a destructive switch.
const UNIT_NORM_TOLERANCE = 1e-2;

// Null = the probe vector is healthy. Otherwise a plain-language reason the model's
// output is unusable (empty / non-finite / not unit-normalized). Order matters:
// emptiness and non-finiteness are checked before the norm (a NaN would poison it).
export function checkProbeVector(vec: Float32Array): string | null {
    if (vec.length === 0) return 'the model returned an empty vector';
    let sumSq = 0;
    for (const v of vec) {
        if (!Number.isFinite(v)) return 'the model returned a non-finite vector (NaN or Infinity)';
        sumSq += v * v;
    }
    const norm = Math.sqrt(sumSq);
    if (Math.abs(norm - 1) > UNIT_NORM_TOLERANCE) {
        return `the model's output is not unit-normalized (norm ${norm.toFixed(3)}, expected ~1.0)`;
    }
    return null;
}

// Turn a raw transformers.js load failure into a plain-language explanation, always
// keeping the raw error in parentheses for diagnostics. The buckets are the failures
// a user typing a fresh HF slug actually hits: a missing onnx weight for the chosen
// dtype, a private/gated repo, and being offline. Anything else falls through to a
// generic message (still with the raw error appended).
export function describeModelLoadError(raw: string): string {
    const lead = describeModelLoadLead(raw);
    return `${lead} (${raw})`;
}

function describeModelLoadLead(raw: string): string {
    // A 404 on the model file = transformers.js couldn't find onnx/model_<dtype>.onnx
    // for this repo. The most common cause is a dtype the repo didn't export.
    if (/\b404\b|could not locate|not found|no such file|does not (?:appear to )?have/i.test(raw)) {
        return "This repo doesn't have ONNX weights for the selected dtype — try a different dtype (q4 / q8 / fp32)";
    }
    // 401/403 = the repo is private or gated; Seeker can only load public models.
    if (/\b401\b|\b403\b|unauthorized|forbidden|gated|access to model|authentication/i.test(raw)) {
        return 'This repo is private or gated on Hugging Face — Seeker can only load public models';
    }
    // A fetch/network failure = offline or the Hub is unreachable.
    if (/failed to fetch|networkerror|network error|err_|enotfound|getaddrinfo|econnrefused|timed out|timeout/i.test(raw)) {
        return "Couldn't reach Hugging Face — check your network connection and try again";
    }
    return 'The model failed to load';
}
