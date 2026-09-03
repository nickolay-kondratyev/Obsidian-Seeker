import { describe, it, expect } from 'vitest';
import { seekerTokenize, hasCjk, segmentCjkToken, splitCamel } from './tokenize';

// Node ≥16 ships Intl.Segmenter with full ICU, so these tests exercise the
// REAL segmentation path the Obsidian renderer (Electron/V8) uses. Exact
// segment boundaries are ICU-dictionary-dependent and may shift across ICU
// versions — tests assert structural properties (multiple terms, no giant
// run, key words present), not the full segmentation.

describe('hasCjk', () => {
    it('detects Han, kana, and Hangul; passes Latin', () => {
        expect(hasCjk('東京')).toBe(true);
        expect(hasCjk('ラーメン')).toBe(true);
        expect(hasCjk('검색')).toBe(true);
        expect(hasCjk('tokyo ramen')).toBe(false);
        expect(hasCjk('café')).toBe(false);    // diacritics are not CJK
    });
});

describe('seekerTokenize — Latin path: space/punct + \\p{Sm} delimiters', () => {
    it('splits on whitespace, punctuation, AND math symbols', () => {
        // '+' is now a DELIMITER (2026-06-25 URL cleanup): \p{Sm} joined the
        // delimiter class so URL/query operators (= + ~) split instead of
        // locking into opaque tokens. Was ['Hybrid','search','BM25','+','dense'].
        expect(seekerTokenize('Hybrid search, BM25 + dense!')).toEqual(
            ['Hybrid', 'search', 'BM25', 'dense']);
    });
    it('does not fold case or touch diacritics (processTerm owns that)', () => {
        expect(seekerTokenize('Café Zürich')).toEqual(['Café', 'Zürich']);
    });
});

describe('seekerTokenize — CJK segmentation', () => {
    it('segments a Chinese sentence into multiple words (was ONE token)', () => {
        const terms = seekerTokenize('我喜欢在瑞士的酒店');
        expect(terms.length).toBeGreaterThan(2);
        expect(Math.max(...terms.map(t => t.length))).toBeLessThan(5);
    });
    it('segments Japanese mixed kana/kanji text', () => {
        const terms = seekerTokenize('東京のラーメン屋を検索する');
        expect(terms.length).toBeGreaterThan(3);
        expect(terms).toContain('東京');
        expect(terms).toContain('ラーメン');
    });
    it('handles mixed Latin+CJK tokens', () => {
        const terms = seekerTokenize('GPU加速で検索');
        expect(terms.join(' ')).toContain('GPU');
        expect(terms.length).toBeGreaterThan(2);
    });
    it('keeps Korean eojeol intact or finer — never a giant merged run', () => {
        const terms = seekerTokenize('검색 엔진 최적화');
        expect(terms.length).toBeGreaterThanOrEqual(3);
    });
});

describe('segmentCjkToken', () => {
    it('never returns empty for a non-empty token', () => {
        expect(segmentCjkToken('的').length).toBeGreaterThan(0);
    });
});

// ── Item 6: punctuation-glued compound tokens (additive) ──────────────────
// 2026-06-18 audit §6: query "gpt4" could not reach a doc that wrote "GPT-4".
// seekerTokenize now ALSO emits the glue-stripped joined form, on both sides.
describe('seekerTokenize — glue-compound joins (audit §6)', () => {
    it('emits the punctuation-stripped joined form additively', () => {
        expect(seekerTokenize('GPT-4')).toEqual(['GPT', '4', 'GPT4']);
        expect(seekerTokenize('co-pilot')).toEqual(['co', 'pilot', 'copilot']);
        expect(seekerTokenize('granite-r2 model')).toEqual(['granite', 'r2', 'graniter2', 'model']);
        expect(seekerTokenize('TCP/IP')).toEqual(['TCP', 'IP', 'TCPIP']);
        expect(seekerTokenize('v2.0')).toEqual(['v2', '0', 'v20']);
    });
    it('joins a run of 3+ glued fragments ONCE (U.S.A -> USA), never pairwise', () => {
        expect(seekerTokenize('U.S.A')).toEqual(['U', 'S', 'A', 'USA']);
    });
    it('a single glue-free fragment yields no redundant join token', () => {
        expect(seekerTokenize('hello')).toEqual(['hello']);
    });
    it('whitespace and non-glue punctuation are real boundaries (no join)', () => {
        expect(seekerTokenize('gpt 4')).toEqual(['gpt', '4']);   // space
        expect(seekerTokenize('a,b')).toEqual(['a', 'b']);       // comma is not glue
    });
    it('a CJK fragment flushes the Latin run — never merged across the segmenter', () => {
        const terms = seekerTokenize('東京-tokyo');
        expect(terms).toContain('tokyo');
        expect(terms.some(t => t.includes('東') && t.includes('tokyo'))).toBe(false);
    });
});

// ── camelCase inverse-split (2026-06-23, additive) ────────────────────────
// Query `verge` could not reach a doc whose only signal is the tag `theVerge`
// (collapsed to one token). The split is the EASY "conservative" case (Hill et
// al. 2013, ~93% accurate); same-case glued stems (theverge.com → theverge) are
// the HARD case we deliberately do NOT attempt.
describe('splitCamel — conservative camelCase boundaries', () => {
    it('returns parts (≥2) on a case transition, [] otherwise', () => {
        expect(splitCamel('theVerge')).toEqual(['the', 'Verge']);
        expect(splitCamel('XMLParser')).toEqual(['XML', 'Parser']);   // acronym run keeps trailing word
        expect(splitCamel('blogs')).toEqual([]);                       // no boundary
        expect(splitCamel('GPT4')).toEqual([]);                        // letter→number is NOT a boundary
    });
});

describe('seekerTokenize — additive camelCase split', () => {
    it('emits camelCase parts additively, canonical token first', () => {
        expect(seekerTokenize('theVerge')).toEqual(['theVerge', 'the', 'Verge']);
        expect(seekerTokenize('macEvolution')).toEqual(['macEvolution', 'mac', 'Evolution']);
        expect(seekerTokenize('steveJobsLegacy')).toEqual(['steveJobsLegacy', 'steve', 'Jobs', 'Legacy']);
        expect(seekerTokenize('PowerShot')).toEqual(['PowerShot', 'Power', 'Shot']);
    });
    it('makes a camelCase sub-tag reachable by sub-word (blogs/theVerge)', () => {
        const terms = seekerTokenize('blogs/theVerge');
        expect(terms).toContain('Verge');          // → `verge` after processTerm lowercases: now an EXACT doc hit
        expect(terms).toContain('theVerge');       // canonical preserved
        expect(terms).toContain('blogstheVerge');  // glue-join still fires alongside the split
    });
    it('splits on the case cue but keeps letter-number ids whole', () => {
        // r2/v2/SD500 must stay exact (fuzzy ladder + glue-join own them); only
        // the CASE transition splits, never letter↔number.
        expect(seekerTokenize('GPT4')).toEqual(['GPT4']);
        expect(seekerTokenize('SD500')).toEqual(['SD500']);
        expect(seekerTokenize('graniteR2')).toEqual(['graniteR2', 'granite', 'R2']);  // case splits; R2 stays whole
    });
    it('does NOT recover `verge` from a same-case glued domain stem (documented limit)', () => {
        // No case cue after the URL is lowercased — the HARD regime we skip. The
        // `.` split still separates `com`, but `theverge` stays opaque.
        const terms = seekerTokenize('theverge.com');
        expect(terms).not.toContain('verge');
        expect(terms).toContain('theverge');
    });
});

// ── canonical-only mode (derived:false) — the bound/normalization enumerator ──
// The DEFAULT path is byte-identical to the asserts above; derived:false drops
// ONLY the additive camelCase split + glue-join, leaving the canonical stream.
describe('seekerTokenize — derived:false (canonical-only, for getQueryBound)', () => {
    it('default is unchanged (derived recall forms still emitted)', () => {
        expect(seekerTokenize('theverge.com')).toEqual(['theverge', 'com', 'thevergecom']);
        expect(seekerTokenize('GPT-4')).toEqual(['GPT', '4', 'GPT4']);
        expect(seekerTokenize('theVerge')).toEqual(['theVerge', 'the', 'Verge']);
    });
    it('drops the glue-join compound — `thevergecom` no longer inflates the bound', () => {
        expect(seekerTokenize('theverge.com', { derived: false })).toEqual(['theverge', 'com']);
        expect(seekerTokenize('GPT-4', { derived: false })).toEqual(['GPT', '4']);
        expect(seekerTokenize('TCP/IP', { derived: false })).toEqual(['TCP', 'IP']);
    });
    it('drops the additive camelCase parts but keeps the canonical token', () => {
        expect(seekerTokenize('theVerge', { derived: false })).toEqual(['theVerge']);
        expect(seekerTokenize('blogs/theVerge', { derived: false })).toEqual(['blogs', 'theVerge']);
    });
    it('leaves single tokens and CJK segmentation untouched (no derived forms there)', () => {
        expect(seekerTokenize('imogene', { derived: false })).toEqual(['imogene']);
        expect(seekerTokenize('我喜欢', { derived: false })).toEqual(seekerTokenize('我喜欢'));
    });
});

// ── \p{Sm} delimiter: URL/query-string operators split (2026-06-25) ───────
// `+` (URL-encoded space), `=`/`&` (query params), `~` no longer lock runs into
// opaque tokens. \p{Sm} is non-glue, so it flushes the join (no `keyvalue`).
describe('seekerTokenize — \\p{Sm} splits URL/query operators', () => {
    it('splits URL-encoded spaces so place names become searchable words', () => {
        // Was the single opaque token "198+E+5th+St+Garage" (unsearchable).
        const t = seekerTokenize('100-198+E+5th+St+Garage');
        expect(t).toContain('5th');
        expect(t).toContain('St');
        expect(t).toContain('Garage');
        expect(t.some(x => x.includes('+'))).toBe(false);
    });
    it('splits query-string key=value into distinct tokens (no join)', () => {
        const t = seekerTokenize('id=12345&ref=hn');
        expect(t).toContain('id');
        expect(t).toContain('12345');
        expect(t).toContain('ref');
        expect(t).toContain('hn');
        expect(t).not.toContain('id12345');   // non-glue: never concatenated
    });
    it('drops standalone math operators (not search terms)', () => {
        expect(seekerTokenize('a = b')).toEqual(['a', 'b']);
        expect(seekerTokenize('C++')).toEqual(['C']);   // consistent with C# -> C
    });
});

// ── Item 7: possessive 's strip ───────────────────────────────────────────
describe('seekerTokenize — possessive strip (audit §7)', () => {
    it('drops a true possessive clitic (straight and curly apostrophe)', () => {
        expect(seekerTokenize("ryan's")).toEqual(['ryan']);
        expect(seekerTokenize("ryan's note")).toEqual(['ryan', 'note']);
        expect(seekerTokenize('ryan’s note')).toEqual(['ryan', 'note']);  // U+2019
        expect(seekerTokenize("boss's car")).toEqual(['boss', 'car']);
    });
    it("removes the junk bare 's' AND the junk glue-join item 6 would add", () => {
        // Pre-strip, "ryan's" tokenizes to ["ryan","s","ryans"] (bare-s junk +
        // glue-join junk via the apostrophe in GLUE_RUN); the strip kills both.
        expect(seekerTokenize("ryan's")).not.toContain('s');
        expect(seekerTokenize("ryan's")).not.toContain('ryans');
    });
    it('is letter-anchored — keeps a digit decade and recovers it via the join', () => {
        // "1990's" is a decade, not a possessive: 1990 kept, "1990s" recovered.
        expect(seekerTokenize("1990's music")).toEqual(['1990', 's', '1990s', 'music']);
    });
    it("leaves contractions alone ('t is not the possessive 's)", () => {
        expect(seekerTokenize("don't")).toContain('don');
    });
});

// ── Byte-identity: canonical tokens == the old SPACE_OR_PUNCT split ────────
// The glue-join is strictly ADDITIVE; on glue/possessive-free input the
// tokenizer must reproduce the exact MiniSearch-default split, because the
// coverage denominator + theoretical bound (bm25.ts) enumerate these tokens.
describe('seekerTokenize — additive invariant (byte-identical canonical split)', () => {
    const refSplit = (t: string) => t.split(/[\n\r\p{Z}\p{P}\p{Sm}]+/u).filter(Boolean);
    it('matches the reference split on glue-free, possessive-free input', () => {
        const cases = [
            'Hybrid search, BM25 + dense!',
            'a,b;c:d (e) [f] {g}',
            '  leading and trailing  ',
            'quote "word" end',
            'plain words only',
        ];
        for (const c of cases) expect(seekerTokenize(c)).toEqual(refSplit(c));
    });
});
