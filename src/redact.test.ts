// Report redaction is a privacy control, so the tests are written adversarially:
// the interesting cases are the ones where a path could SURVIVE the pass, not the
// ones where it obviously doesn't. The second contract is that redaction must not
// destroy the report — correlation and structural values have to come through.

import { describe, it, expect } from 'vitest';
import { makeRedactor, redactEntries } from './redact';

const SALT = 'test-salt';

describe('makeRedactor', () => {
    it('keeps the extension and drops every folder name', () => {
        const r = makeRedactor(SALT);
        const out = r.path('Personal/Therapy/2026-07-23 session.md');
        expect(out).toMatch(/^note-[0-9a-f]{8}\.md$/);
        expect(out).not.toMatch(/Therapy|Personal|session/);
    });

    it('distinguishes the extensions that select a chunker path', () => {
        const r = makeRedactor(SALT);
        expect(r.path('a/b.base')).toMatch(/\.base$/);
        expect(r.path('a/b.canvas')).toMatch(/\.canvas$/);
        expect(r.path('a/b')).toBe(`note-${/note-([0-9a-f]{8})/.exec(r.path('a/b'))![1]}`);
    });

    it('is stable within a salt and divergent across salts', () => {
        const a = makeRedactor('salt-a');
        const b = makeRedactor('salt-b');
        expect(a.path('Notes/X.md')).toBe(a.path('Notes/X.md'));   // correlation survives
        expect(a.path('Notes/X.md')).not.toBe(b.path('Notes/X.md')); // cross-report matching does not
    });

    it('reduces a query to shape only', () => {
        const r = makeRedactor(SALT);
        expect(r.query('where did I park the car')).toBe('«query:24c/6w»');
        expect(r.query('')).toBe('«query:0c/0w»');
    });
});

describe('generic path scrub', () => {
    const r = makeRedactor(SALT);

    it('rewrites paths embedded in free-text error messages', () => {
        // Quoted paths are the common real shape (Node, Obsidian) and are cleanly
        // delimited, so the surrounding prose survives.
        const out = r.scrub(`ENOENT: no such file, open '1.5 Inbox/Private Journal.md'`);
        // Assert on each token separately — an earlier version of this test checked
        // only the contiguous 'Private Journal' and passed while leaking '1.5 Inbox'
        // and 'Private', because the partial match had merely split them apart.
        for (const token of ['1.5 Inbox', 'Private', 'Journal']) expect(out).not.toContain(token);
        expect(out).toContain('ENOENT: no such file, open');
    });

    it('absorbs preceding prose rather than leaking a spaced folder name', () => {
        // The documented fail-safe direction: with no delimiter, the match extends
        // left through the prose. Losing "failed to read" is the accepted cost of
        // never leaking "1.5 Inbox".
        const out = r.scrub('failed to read 1.5 Inbox/Private Journal.md');
        for (const token of ['1.5 Inbox', 'Private', 'Journal']) expect(out).not.toContain(token);
        expect(out).toMatch(/^note-[0-9a-f]{8}\.md$/);
    });

    it('strips the account name from absolute OS paths', () => {
        expect(r.scrub('open /Users/jane/Vault/notes failed')).not.toContain('jane');
        expect(r.scrub(String.raw`C:\Users\jane\Vault failed`)).not.toContain('jane');
        // app://local/ model URLs embed the vault path — the reason this alternative
        // does not require a file extension.
        expect(r.scrub('fetch app://local/Users/jane/Vault/.obsidian/model.onnx')).not.toContain('jane');
    });

    it('leaves slash-bearing structural values alone', () => {
        // The regression this guards: a model id is not a path, and redacting it
        // would blind every embed triage.
        expect(r.scrub('onnx-community/granite-embedding-107m-multilingual')).toBe('onnx-community/granite-embedding-107m-multilingual');
        expect(r.scrub('2026-07-23T22:03:40.123Z')).toBe('2026-07-23T22:03:40.123Z');
        expect(r.scrub('bm25-warm')).toBe('bm25-warm');
        expect(r.scrub('1.1.1')).toBe('1.1.1');
    });

    it('passes through unqualified plugin-owned artifacts', () => {
        expect(r.scrub('could not write seeker-report.json')).toContain('seeker-report.json');
        // …but not once they carry vault structure.
        expect(r.scrub('.obsidian/plugins/seeker/logs/seeker-log-a1.ndjson')).not.toContain('.obsidian');
    });
});

describe('redactEntries', () => {
    it('redacts every known private field of a search row', () => {
        const [out] = redactEntries([{
            type: 'search',
            timestamp: '2026-07-23T22:03:40.000Z',
            query: 'tax return 2025',
            cleanedQuery: 'tax return',
            filters: { tags: ['#finance/personal'], includePaths: ['Money/'], frontmatter: { client: 'Acme Corp' } },
            fusedTop50: [{ chunk_id: 'a1b2c3', note_path: 'Money/Taxes 2025.md', title: 'Taxes 2025', rank: 1, score: 0.9 }],
            totalMs: 120,
        }] as never[], SALT) as Array<Record<string, never>>;

        const flat = JSON.stringify(out);
        for (const secret of ['tax return', 'finance/personal', 'Money', 'Taxes 2025', 'Acme Corp', 'client']) {
            expect(flat).not.toContain(secret);
        }
        // Structure and metrics survive intact — that's the whole point.
        expect(out.type).toBe('search');
        expect(out.timestamp).toBe('2026-07-23T22:03:40.000Z');
        expect(out.totalMs).toBe(120);
        expect((out.fusedTop50 as never[])[0]).toMatchObject({ chunk_id: 'a1b2c3', rank: 1, score: 0.9 });
    });

    it('treats the whole filters subtree as user input, keeping operators legible', () => {
        const [out] = redactEntries([{
            type: 'search',
            filters: {
                tags: ['#therapy'],
                tagsMatchAll: false,
                numeric: [{ key: 'salary', op: '>', value: 50 }],
                numericTypeMismatch: ['pageType'],
                exclude: ['divorce'],
                dateAfter: '2026-01-01',
            },
        }] as never[], SALT) as Array<Record<string, never>>;

        const flat = JSON.stringify(out.filters);
        // Every leaf QueryFilters has ever grown — including the ones no leaf-list
        // would have covered.
        for (const secret of ['therapy', 'salary', 'pageType', 'divorce', '2026-01-01']) {
            expect(flat).not.toContain(secret);
        }
        // Structure survives: how many filters, of what kind, with which operator.
        expect((out.filters as Record<string, never>).tagsMatchAll).toBe(false);
        expect(((out.filters as Record<string, never>).numeric as never[])[0]).toMatchObject({ op: '>', value: 50 });
    });

    it('preserves cross-entry correlation on the same path', () => {
        const [idx, click] = redactEntries([
            { type: 'index-complete', committedFilePaths: ['Journal/2026-07-23.md'], chunksIndexed: 56 },
            { type: 'click', note_path: 'Journal/2026-07-23.md', rank: 1 },
        ] as never[], SALT) as Array<Record<string, never>>;
        // "the same note was re-indexed and then clicked" must still be readable.
        expect((idx.committedFilePaths as string[])[0]).toBe(click.note_path);
    });

    it('does not mutate the caller\'s entries', () => {
        const src = [{ type: 'click', note_path: 'Secret/Note.md' }] as never[];
        redactEntries(src, SALT);
        expect((src[0] as { note_path: string }).note_path).toBe('Secret/Note.md');
    });

    it('covers a path field the typed policy has never heard of', () => {
        // Schema drift is the failure mode this pass exists for: a future entry
        // type adds a path-bearing field and nobody updates PATH_KEYS. The value
        // carries a space in BOTH the folder and the filename — the shape that
        // defeated the first version of the detector.
        const [out] = redactEntries([{ type: 'future', someNewField: 'Old Archive/Old Note.md' }] as never[], SALT) as Array<Record<string, string>>;
        for (const token of ['Archive', 'Old', 'Note']) expect(out.someNewField).not.toContain(token);
        expect(out.someNewField).toMatch(/^note-[0-9a-f]{8}\.md$/);
    });
});
