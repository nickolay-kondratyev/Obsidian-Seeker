// OCR language selection — mapping Obsidian's UI locale to a tesseract.js
// language pack code, and resolving the effective pack set for the engine.
//
// tesseract.js needs ONE traineddata pack per language (no auto-detection),
// each 2-12 MB, fetched from the tessdata CDN and Cache-API-cached like the
// embedding model (docs/research/image-ocr.md §9 Q4/Q5). So the default is the
// user's own language plus English — the pair the spike showed is affordable at
// runtime (§13: eng+deu is a one-time download and ~0 per-image cost). The user
// can override the set from settings; a change never re-OCRs cached images
// (§12 D2).
//
// Pure except defaultOcrLangs' single localStorage read (Obsidian stores the UI
// language under the `language` key); mapLocaleToTesseract + effectiveOcrLangs
// are pure and unit-tested.

import type { SeekerSettings } from './types';

// The tesseract pack every default includes — the lingua franca of screenshots
// (menus, code, English UI chrome) even on a non-English vault.
export const DEFAULT_OCR_LANG = 'eng';

// Obsidian UI locale (localStorage `language`) → tesseract.js pack code. Covers
// Obsidian's shipped languages; an unmapped locale falls back to `eng` alone.
// tesseract codes are ISO 639-2/T (three-letter); Obsidian's are shorter.
const LOCALE_TO_TESSERACT: Readonly<Record<string, string>> = {
    en: 'eng',
    zh: 'chi_sim', 'zh-tw': 'chi_tra',
    ru: 'rus', ko: 'kor', ja: 'jpn',
    it: 'ita', id: 'ind', ro: 'ron',
    pt: 'por', 'pt-br': 'por',
    cz: 'ces', da: 'dan', de: 'deu',
    es: 'spa', fr: 'fra', no: 'nor',
    nb: 'nor', pl: 'pol', nl: 'nld',
    ar: 'ara', fa: 'fas', tr: 'tur',
    he: 'heb', hi: 'hin', th: 'tha',
    uk: 'ukr', vi: 'vie', el: 'ell',
    sv: 'swe', fi: 'fin', hu: 'hun',
    sr: 'srp', am: 'amh', ta: 'tam',
    ml: 'mal', te: 'tel', be: 'bel',
};

// The tesseract pack for an Obsidian locale, or null when unmapped. The locale
// is normalised (lower-cased, `_` → `-`) so `zh_TW`, `zh-TW` and `pt_BR` all hit.
export function mapLocaleToTesseract(locale: string): string | null {
    const norm = locale.trim().toLowerCase().replace(/_/g, '-');
    if (norm in LOCALE_TO_TESSERACT) return LOCALE_TO_TESSERACT[norm];
    const base = norm.split('-')[0];   // `de-at` → `de`
    return LOCALE_TO_TESSERACT[base] ?? null;
}

// The AUTO default pack set: the device's Obsidian locale mapped to a pack, plus
// `eng`, deduped and `eng`-last-if-added. Reads Obsidian's `language` localStorage
// key (absent / 'en' → just English). Isolated here so it stays the one place a
// locale read happens.
export function defaultOcrLangs(): string[] {
    let locale = 'en';
    try {
        locale = window.localStorage.getItem('language') || 'en';
    } catch { /* localStorage unavailable — default to English */ }
    const mapped = mapLocaleToTesseract(locale);
    if (mapped === null || mapped === DEFAULT_OCR_LANG) return [DEFAULT_OCR_LANG];
    return [mapped, DEFAULT_OCR_LANG];
}

// The packs the engine actually loads: the user's explicit list when set, else
// the AUTO default. An empty explicit list is treated as AUTO (an engine must
// load at least one pack), so clearing the settings field reverts to AUTO.
export function effectiveOcrLangs(settings: Pick<SeekerSettings, 'ocrLangs'>): string[] {
    const chosen = settings.ocrLangs.map(l => l.trim().toLowerCase()).filter(l => l.length > 0);
    const deduped = [...new Set(chosen)];
    return deduped.length > 0 ? deduped : defaultOcrLangs();
}
