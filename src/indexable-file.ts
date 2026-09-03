// The ONE definition of "which vault files Seeker indexes": markdown notes
// always, plus `.base` (Obsidian Bases, base-extractor.ts) and `.canvas`
// (canvas-extractor.ts) files when their setting is on. Three sites must agree
// on this set or ids drift between writer and re-deriver: the orchestrator's
// collection (search.ts indexableFiles — reindexAll, computeDelta and the sidecar
// liveness oracles), the vault watcher in main.ts (create/modify/rename/delete),
// and the settings tab's reindex progress total. They all call here.
//
// Pure and Obsidian-free (structural vault type) so the gate is unit-testable
// and shared with the FakeVault harness.
import type { TFile } from 'obsidian';
import type { SeekerSettings } from './types';

export type IndexableGate = Pick<SeekerSettings, 'indexBases' | 'indexCanvases'>;

// The slice of Obsidian's Vault the collection reads.
export interface IndexableVault {
    getMarkdownFiles(): TFile[];
    getFiles(): TFile[];
}

export function isIndexableFile(f: TFile, gate: IndexableGate): boolean {
    switch (f.extension) {
        case 'md': return true;
        case 'base': return gate.indexBases;
        case 'canvas': return gate.indexCanvases;
        default: return false;
    }
}

// Markdown first (getMarkdownFiles is Obsidian's cheap, already-filtered list),
// then the non-markdown indexables. Returns the md array itself when there is
// nothing to append, so the all-markdown vault pays nothing extra.
export function collectIndexableFiles(vault: IndexableVault, gate: IndexableGate): TFile[] {
    const md = vault.getMarkdownFiles();
    if (!gate.indexBases && !gate.indexCanvases) return md;
    const extra = vault.getFiles().filter(f => f.extension !== 'md' && isIndexableFile(f, gate));
    return extra.length === 0 ? md : [...md, ...extra];
}
