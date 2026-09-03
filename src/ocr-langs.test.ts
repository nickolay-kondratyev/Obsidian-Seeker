// OCR language resolution (ocr-langs.ts): Obsidian UI locale → tesseract pack,
// the AUTO default (device locale + eng), and the effective set the engine loads
// (docs/research/image-ocr.md §9 Q4/Q5, §13). Pure except defaultOcrLangs' single
// localStorage read, which we drive through a stubbed window.localStorage.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    DEFAULT_OCR_LANG,
    mapLocaleToTesseract,
    defaultOcrLangs,
    effectiveOcrLangs,
} from './ocr-langs';

// Stand in for Obsidian's localStorage `language` key. Returns `null` for absent
// (the browser contract) so defaultOcrLangs' `|| 'en'` fallback is exercised.
function stubLocale(locale: string | null): void {
    vi.stubGlobal('window', {
        localStorage: { getItem: (k: string) => (k === 'language' ? locale : null) },
    });
}

describe('mapLocaleToTesseract', () => {
    it('maps a shipped Obsidian locale to its three-letter tesseract pack', () => {
        expect(mapLocaleToTesseract('de')).toBe('deu');
    });

    it('normalises case and separator so zh_TW hits the traditional pack', () => {
        expect(mapLocaleToTesseract('zh_TW')).toBe('chi_tra');
    });

    it('falls back to the base subtag for an unmapped region (de-at → deu)', () => {
        expect(mapLocaleToTesseract('de-at')).toBe('deu');
    });

    it('returns null for a locale with no pack at all', () => {
        expect(mapLocaleToTesseract('xx')).toBeNull();
    });
});

describe('defaultOcrLangs', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('pairs the device locale pack with eng, locale first', () => {
        stubLocale('de');
        expect(defaultOcrLangs()).toEqual(['deu', DEFAULT_OCR_LANG]);
    });

    it('is eng alone when the locale already maps to eng (no duplicate)', () => {
        stubLocale('en');
        expect(defaultOcrLangs()).toEqual(['eng']);
    });

    it('is eng alone when the locale has no pack', () => {
        stubLocale('xx');
        expect(defaultOcrLangs()).toEqual(['eng']);
    });

    it('is eng alone when the language key is absent', () => {
        stubLocale(null);
        expect(defaultOcrLangs()).toEqual(['eng']);
    });
});

describe('effectiveOcrLangs', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('uses the explicit list verbatim when set (never re-reads the locale)', () => {
        expect(effectiveOcrLangs({ ocrLangs: ['fra', 'eng'] })).toEqual(['fra', 'eng']);
    });

    it('lower-cases, trims and dedupes an explicit list', () => {
        expect(effectiveOcrLangs({ ocrLangs: [' DEU ', 'deu', 'eng'] })).toEqual(['deu', 'eng']);
    });

    it('treats an empty explicit list as AUTO (falls back to the device default)', () => {
        stubLocale('de');
        expect(effectiveOcrLangs({ ocrLangs: [] })).toEqual(['deu', DEFAULT_OCR_LANG]);
    });

    it('treats a whitespace-only list as AUTO (clearing the field reverts)', () => {
        stubLocale('en');
        expect(effectiveOcrLangs({ ocrLangs: ['  ', ''] })).toEqual(['eng']);
    });
});
