// Single-source-of-truth guard for the embedding dimension.
//
// The dim used to be five hand-hardcoded `384`s (the iframe's OUTPUT_DIM,
// index-store's default meta, sidecar.ts's Q_BYTES/SIGN_BYTES record stride, …).
// They had to agree by hand or a model swap would silently mis-slice vectors
// (write N-d vectors into a 384-byte stride). The sidecar record layout is now a
// PURE function of dim (recordLayout — ticket 2/6), so there are no compile-time
// stride constants left to disagree: every path derives its geometry from the dim
// it is handed (the stored per-record dim on decode, the active dim on encode).
// These tests are the structural replacement for that hand-agreement — recordLayout
// at the active dim composes correctly and matches the live sign-bit packer, and
// the derivation formulas hold at any width a future model might use. (The iframe's
// OUTPUT_DIM is injected from the same spec field at iframe build time, so it is
// covered by construction — see iframe-runner.ts.)

import { describe, it, expect } from 'vitest';
import { ACTIVE_MODEL_SPEC } from './model-registry';
import { recordLayout, S_BYTES, CRC_BYTES } from './sidecar';
import { packSignBits } from './binary';

describe('the record layout is single-sourced from the model spec', () => {
    const layout = recordLayout(ACTIVE_MODEL_SPEC.dim);

    it('qBytes equals the active model dim', () => {
        expect(layout.qBytes).toBe(ACTIVE_MODEL_SPEC.dim);
    });

    it('the sign tier matches binary.ts packing for the active dim', () => {
        expect(layout.signBytes).toBe((ACTIVE_MODEL_SPEC.dim + 7) >> 3);
        // The live packer must produce EXACTLY signBytes for a dim-wide vector, or
        // the record stride and the candidate-tier bytes disagree at runtime.
        expect(packSignBits(new Float32Array(ACTIVE_MODEL_SPEC.dim)).length).toBe(layout.signBytes);
    });

    it('the record stride composes from the tiers', () => {
        expect(layout.payloadBytes).toBe(layout.qBytes + S_BYTES + layout.signBytes);
        expect(layout.vecBytes).toBe(layout.payloadBytes + CRC_BYTES);
    });
});

// Forward-width safety: the derivation FORMULAS must hold at any dimension a
// future model might use, not only today's. recordLayout is pure and can be
// exercised across widths here; the codec round-trip at foreign widths lives in
// sidecar.test.ts.
describe('layout derivation holds across widths', () => {
    // include a non-multiple-of-8 width to exercise the ceil in (d + 7) >> 3.
    for (const d of [256, 384, 512, 768, 1024, 1000]) {
        it(`d=${d}: sign bytes = ceil(d/8), stride composes, packSignBits agrees`, () => {
            const layout = recordLayout(d);
            const signBytes = (d + 7) >> 3;
            expect(layout.qBytes).toBe(d);
            expect(layout.signBytes).toBe(signBytes);
            expect(packSignBits(new Float32Array(d)).length).toBe(signBytes);
            // S_BYTES + CRC_BYTES are dim-independent; the stride scales only via q
            // (d bytes) and the sign tier (ceil(d/8) bytes).
            expect(layout.payloadBytes).toBe(d + S_BYTES + signBytes);
            expect(layout.vecBytes).toBe(d + S_BYTES + signBytes + CRC_BYTES);
        });
    }
});
