// excludeArchiveFolders: notes under any `_archive/` folder stay out of the index.
// Unit-level for the path rule (hasArchiveAncestor / shouldIndexPath) plus tier-2
// scenarios through the REAL orchestrator + store, because the setting only works
// if full reindex AND the catch-up delta both honor it.
import { afterEach, describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { hasArchiveAncestor, shouldIndexPath } from './search';
import { Scenario } from './test-harness/scenario';
import { DEFAULT_SETTINGS, type SeekerSettings } from './types';

describe('hasArchiveAncestor', () => {
    it('is true for a note directly inside a root _archive folder', () => {
        expect(hasArchiveAncestor('_archive/old.md')).toBe(true);
    });

    it('is true for a note nested deeper under a nested _archive folder', () => {
        expect(hasArchiveAncestor('work/_archive/2024/plan.md')).toBe(true);
    });

    it('is false for a note whose own file name is _archive', () => {
        expect(hasArchiveAncestor('work/_archive.md')).toBe(false);
    });

    it('is false for a folder that only contains _archive as a substring', () => {
        expect(hasArchiveAncestor('my_archive-notes/plan.md')).toBe(false);
    });

    it('is false for a differently-cased folder (exact match only)', () => {
        expect(hasArchiveAncestor('_Archive/plan.md')).toBe(false);
    });
});

describe('shouldIndexPath with excludeArchiveFolders', () => {
    const app = { metadataCache: { isUserIgnored: () => false } } as unknown as App;
    const settings = (exclude: boolean): SeekerSettings => ({ ...DEFAULT_SETTINGS, excludeArchiveFolders: exclude });

    it('defaults to OFF', () => {
        expect(DEFAULT_SETTINGS.excludeArchiveFolders).toBe(false);
    });

    it('excludes an _archive note when ON', () => {
        expect(shouldIndexPath(app, settings(true), 'p/_archive/x.md')).toBe(false);
    });

    it('keeps an _archive note when OFF', () => {
        expect(shouldIndexPath(app, settings(false), 'p/_archive/x.md')).toBe(true);
    });
});

describe('excludeArchiveFolders through the real orchestrator', () => {
    let active: Scenario | null = null;
    const ARCHIVED = 'Projects/_archive/old-plan.md';
    const LIVE = 'Projects/plan.md';
    const indexedPaths = async (s: Scenario): Promise<string[]> =>
        (await s.store.listFileRecords()).map(r => r.note_path).sort();

    // GIVEN a vault with one live note and one note under a nested _archive folder.
    const bootWithVault = async (settings: Partial<SeekerSettings>): Promise<Scenario> => {
        const s = new Scenario();
        await s.boot(settings);
        active = s;
        s.vault.write(LIVE, 'a live plan about pottery glazes', 1000);
        s.vault.write(ARCHIVED, 'an archived plan about pottery kilns', 1000);
        return s;
    };
    afterEach(async () => { await active?.teardown(); active = null; });

    it('full reindex with the setting ON indexes only the non-archived note', async () => {
        const s = await bootWithVault({ excludeArchiveFolders: true });
        await s.coldStart();
        expect(await indexedPaths(s)).toEqual([LIVE]);
    });

    it('turning the setting ON drops already-indexed archived notes on the next catch-up', async () => {
        const s = await bootWithVault({ excludeArchiveFolders: false });
        await s.coldStart();

        s.restart({ excludeArchiveFolders: true });
        await s.reconcile();

        expect(await indexedPaths(s)).toEqual([LIVE]);
    });

    it('turning the setting OFF re-adds archived notes on the next catch-up', async () => {
        const s = await bootWithVault({ excludeArchiveFolders: true });
        await s.coldStart();

        s.restart({ excludeArchiveFolders: false });
        await s.reconcile();

        expect(await indexedPaths(s)).toEqual([ARCHIVED, LIVE].sort());
    });
});
