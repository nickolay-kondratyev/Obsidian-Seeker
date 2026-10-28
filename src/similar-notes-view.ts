// The similar-notes side panel (epic nid_z4vwfvotr3lfmjs4ke2ud6isa_e): an
// Obsidian sidebar view that follows the active note and shows the notes most
// like it — the result-map cluster graph (desktop) over a compact ranked list.
// This module is the OBSIDIAN HOST only: it wires workspace signals into the
// Obsidian-free controller (similar-notes-controller.ts: visibility gate,
// latest-wins, debounce) and paints the state the controller hands back. The
// graph is the host-agnostic ResultMapGraph (result-map-graph.ts), with the
// panel's own persisted knobs (SeekerSettings.similarNotesGraphTuning) and two
// panel-only popover controls: the similarity mode (SeekerSettings.similarNotesMode)
// and "Show note list". The list can also be resized or hidden by dragging the
// graph/list divider (similar-notes-split.ts); both ways write the same
// SeekerSettings.similarNotesListCollapsed, painted by one method (paintListSplit).
//
// Visibility: Obsidian has no "view hidden" hook, so every layout signal
// (layout-change, resize, active-leaf-change) re-reads containerEl.isShown() —
// false for a collapsed sidebar, a tab behind another, or a detached leaf.

import { ItemView, TFile, type WorkspaceLeaf } from 'obsidian';
import type { ScoredChunk, SeekerSettings } from './types';
import type { SearchOrchestrator } from './search';
import type { SeekerLogger } from './logger';
import { MIN_VECTORS_FOR_GRAPH } from './result-cluster-model';
import { ResultMapGraph, type ResultMapGraphCopy } from './result-map-graph';
import type { TuningPopoverExtension } from './result-map-tuning';
import { isSimilarityMode, type SimilarityMode } from './similar-notes';
import { SimilarNotesController, type SimilarNotesEmptyReason, type SimilarNotesState } from './similar-notes-controller';
import { noteTitle } from './search-modal';
import { GraphListDivider, type ListSplit } from './similar-notes-split';

export const SIMILAR_NOTES_VIEW_TYPE = 'seeker-similar-notes';
export const SIMILAR_NOTES_VIEW_TITLE = 'Similar notes';
// Enough to fill the graph with structure without the list becoming a scroll chore.
export const SIMILAR_NOTES_TOP_K = 20;
// A sidebar drag fires resize per frame; re-lay out (~20 ms force run) once it settles.
const RESIZE_RELAYOUT_DEBOUNCE_MS = 150;

// The panel ranks against the active note, so the centre node is that note.
const SIMILAR_NOTES_COPY: ResultMapGraphCopy = {
    title: SIMILAR_NOTES_VIEW_TITLE,
    centreLabel: 'This note',
    caption: 'Nearer the centre = more similar · same colour = alike · grey = not grouped',
};

export const SIMILARITY_MODE_LABELS: Readonly<Record<SimilarityMode, string>> = {
    'best-chunk': 'Best matching section',
    average: 'Whole note average',
};
const SIMILARITY_MODE_HINT = 'Best matching section: a note is similar when one of its sections matches one section of this note. '
    + 'Whole note average: notes about the same thing as this note as a whole.';

// Plain-language copy per empty/error state, in the user's words.
export const SIMILAR_NOTES_MESSAGES: Readonly<Record<Exclude<SimilarNotesState['kind'], 'results' | 'loading'>, string>> = {
    'no-note': 'Open a note to see the notes most like it.',
    'no-index': 'Your vault isn’t indexed yet. Index it in Seeker settings to see similar notes.',
    'not-indexed': 'This note isn’t indexed yet. Seeker picks it up on its next index update.',
    'none-similar': 'No similar notes found.',
    error: 'Couldn’t load similar notes.',
};

export interface SimilarNotesViewDeps {
    orchestrator: Pick<SearchOrchestrator, 'similarNotes' | 'resultVectors' | 'onIndexChanged' | 'indexedChunkCount' | 'isNoteIndexed'>;
    // The plugin's live settings object (mutated in place like every other UI).
    settings: SeekerSettings;
    saveSettings(): Promise<void>;
    logger: Pick<SeekerLogger, 'appendError'>;
    // Mobile shows the list only (the graph is desktop-only, like the result map).
    isMobile: boolean;
}

export class SimilarNotesView extends ItemView {
    private readonly controller: SimilarNotesController;
    private graph: ResultMapGraph | null = null;
    private sourceEl!: HTMLElement;
    private listEl!: HTMLElement;
    private messageEl!: HTMLElement;
    // The popover's "Show note list" checkbox; null until the popover is built (desktop only).
    private showListInput: HTMLInputElement | null = null;
    private results: readonly ScoredChunk[] = [];
    private rows: HTMLElement[] = [];
    private selected = 0;
    private unsubscribeIndexChanged: (() => void) | null = null;
    // Pending debounced re-layout after a resize; 0 = none.
    private resizeTimer = 0;
    // Not a navigation view: it must never be replaced by a note opening into its leaf.
    navigation = false;

    constructor(leaf: WorkspaceLeaf, private readonly deps: SimilarNotesViewDeps) {
        super(leaf);
        this.controller = new SimilarNotesController({
            similarNotes: (notePath, mode) => deps.orchestrator.similarNotes(notePath, mode, SIMILAR_NOTES_TOP_K),
            emptyReason: notePath => this.emptyReason(notePath),
            mode: () => deps.settings.similarNotesMode,
            render: state => this.render(state),
            schedule: (fn, ms) => {
                const win = this.containerEl.win;
                const id = win.setTimeout(fn, ms);
                return () => win.clearTimeout(id);
            },
            reportFailure: e => this.reportFailure('similar-notes', e),
        });
    }

    getViewType(): string {
        return SIMILAR_NOTES_VIEW_TYPE;
    }

    getDisplayText(): string {
        return SIMILAR_NOTES_VIEW_TITLE;
    }

    getIcon(): string {
        return 'git-fork';
    }

    async onOpen(): Promise<void> {
        const root = this.contentEl;
        root.empty();
        root.addClass('seeker-similar-view');
        this.sourceEl = root.createDiv({ cls: 'seeker-similar-source' });
        if (!this.deps.isMobile) this.graph = this.buildGraph(root);
        this.messageEl = root.createDiv({ cls: 'seeker-similar-message' });
        this.listEl = root.createDiv({ cls: 'seeker-similar-list' });
        if (this.graph) this.buildDivider(root, this.graph.el);
        this.paintListSplit(this.listSplit());

        const ws = this.app.workspace;
        this.registerEvent(ws.on('active-leaf-change', leaf => this.onActiveLeafChange(leaf)));
        this.registerEvent(ws.on('layout-change', () => this.refreshVisibility()));
        this.unsubscribeIndexChanged = this.deps.orchestrator.onIndexChanged(() => this.controller.indexChanged());

        this.controller.setActiveNote(ws.getActiveFile()?.path ?? null);
        this.refreshVisibility();
    }

    async onClose(): Promise<void> {
        this.unsubscribeIndexChanged?.();
        this.unsubscribeIndexChanged = null;
        this.containerEl.win.clearTimeout(this.resizeTimer);
        this.controller.dispose();
        this.graph?.destroy();
        this.graph = null;
    }

    // ── Obsidian signals in ─────────────────────────────────────────────────

    // Only leaves in a main area (root split or a popout window) carry the note to
    // follow; a sidebar leaf becoming active (this panel, the file explorer, …)
    // must not drop the note the user is reading.
    private onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
        const ws = this.app.workspace;
        const root = leaf?.getRoot();
        const inSidebar = root === ws.leftSplit || root === ws.rightSplit;
        if (leaf && !inSidebar) this.controller.setActiveNote(ws.getActiveFile()?.path ?? null);
        this.refreshVisibility();
    }

    private refreshVisibility(): void {
        this.controller.setVisible(this.containerEl.isShown());
    }

    // Obsidian's per-view resize hook (sidebar drag, window resize, tab shown).
    onResize(): void {
        this.refreshVisibility();
        const win = this.containerEl.win;
        win.clearTimeout(this.resizeTimer);
        this.resizeTimer = win.setTimeout(() => this.graph?.relayout(), RESIZE_RELAYOUT_DEBOUNCE_MS);
    }

    private async emptyReason(notePath: string): Promise<SimilarNotesEmptyReason> {
        const chunks = await this.deps.orchestrator.indexedChunkCount();
        if (chunks === null || chunks === 0) return 'no-index';
        return (await this.deps.orchestrator.isNoteIndexed(notePath)) ? 'none-similar' : 'not-indexed';
    }

    // ── paint ───────────────────────────────────────────────────────────────

    private render(state: SimilarNotesState): void {
        this.sourceEl.setText(state.kind === 'no-note' ? '' : noteTitle(state.notePath));
        this.contentEl.toggleClass('is-loading', state.kind === 'loading');
        // Loading keeps the previous content (dimmed by CSS) until the answer lands — no flash.
        if (state.kind === 'loading') return;
        if (state.kind === 'results') {
            this.showResults(state.results);
            return;
        }
        this.showResults([]);
        this.setMessage(SIMILAR_NOTES_MESSAGES[state.kind]);
    }

    private showResults(results: readonly ScoredChunk[]): void {
        this.results = results;
        this.selected = 0;
        this.setMessage('');
        this.paintList();
        if (!this.graph) return;
        const showGraph = results.length >= MIN_VECTORS_FOR_GRAPH;
        // Without the graph the list is all there is: the collapsed flag (and the divider) step aside.
        this.contentEl.toggleClass('has-graph', showGraph);
        if (!showGraph) {
            this.graph.hide();
            return;
        }
        this.graph.setSelected(this.selected);
        this.graph.show(results, results.map(r => noteTitle(r.note_path)));
    }

    private setMessage(message: string): void {
        this.messageEl.setText(message);
        this.messageEl.toggle(message.length > 0);
    }

    private paintList(): void {
        this.listEl.empty();
        this.rows = this.results.map((r, i) => {
            const row = this.listEl.createDiv({ cls: 'seeker-similar-row', attr: { 'data-result-index': i, title: r.note_path } });
            row.createSpan({ cls: 'seeker-similar-row-title', text: noteTitle(r.note_path) });
            row.addEventListener('mouseenter', () => this.select(i));
            row.addEventListener('click', e => this.openResult(i, e));
            return row;
        });
        this.paintSelection();
    }

    private select(i: number): void {
        this.selected = i;
        this.paintSelection();
        this.graph?.setSelected(i);
    }

    private paintSelection(): void {
        this.rows.forEach((row, i) => row.toggleClass('is-selected', i === this.selected));
    }

    private openResult(i: number, evt: MouseEvent): void {
        const r = this.results[i];
        if (!r) return;
        const file = this.app.vault.getAbstractFileByPath(r.note_path);
        if (!(file instanceof TFile)) return;
        const newTab = evt.metaKey || evt.ctrlKey;
        void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file)
            .catch(e => this.reportFailure('similar-notes:open', e));
    }

    // ── graph host ──────────────────────────────────────────────────────────

    private buildGraph(parent: HTMLElement): ResultMapGraph {
        const { settings } = this.deps;
        return new ResultMapGraph(parent, SIMILAR_NOTES_COPY, {
            onNodeHover: i => this.select(i),
            onNodeClick: (i, e) => this.openResult(i, e),
            fetchVectors: results => this.deps.orchestrator.resultVectors(results),
            reportFailure: e => this.reportFailure('similar-notes:map', e),
            tuning: () => settings.similarNotesGraphTuning,
            setTuning: options => { settings.similarNotesGraphTuning = options; },
            persistTuning: () => this.persistSettings(),
            // Nothing in the panel needs focus back; the sidebar keeps it.
            restoreFocus: () => {},
            buildTuningExtension: container => this.buildPanelControls(container),
        });
    }

    // ── graph/list split ────────────────────────────────────────────────────

    private buildDivider(parent: HTMLElement, mapEl: HTMLElement): void {
        new GraphListDivider(parent, mapEl, this.listEl, {
            current: () => this.listSplit(),
            preview: split => this.paintListSplit(split),
            commit: split => this.commitListSplit(split),
        });
    }

    private listSplit(): ListSplit {
        const { settings } = this.deps;
        return { collapsed: settings.similarNotesListCollapsed, share: settings.similarNotesListShare };
    }

    // The ONE painter of the split: the share, the collapsed class and the
    // popover's checkbox, so the divider and the checkbox never disagree.
    private paintListSplit(split: ListSplit): void {
        this.contentEl.style.setProperty('--seeker-similar-list-share', String(split.share));
        this.contentEl.toggleClass('is-list-collapsed', split.collapsed);
        if (this.showListInput) this.showListInput.checked = !split.collapsed;
    }

    private commitListSplit(split: ListSplit): void {
        const { settings } = this.deps;
        settings.similarNotesListCollapsed = split.collapsed;
        settings.similarNotesListShare = split.share;
        this.paintListSplit(split);
        this.persistSettings();
        // Obsidian's onResize only fires for the leaf, not for a split inside it.
        this.graph?.relayout();
    }

    // ── popover controls ────────────────────────────────────────────────────

    // The panel-only popover controls: which similarity the graph shows, then
    // whether the note list shows under it.
    private buildPanelControls(container: HTMLElement): TuningPopoverExtension {
        const syncMode = this.buildModeControl(container);
        this.buildShowListControl(container);
        return {
            sync: () => {
                syncMode();
                this.paintListSplit(this.listSplit());
            },
        };
    }

    // Returns its sync (repaint from the live setting).
    private buildModeControl(container: HTMLElement): () => void {
        const { settings } = this.deps;
        const row = container.createDiv({ cls: 'seeker-map-tuning-row', attr: { title: SIMILARITY_MODE_HINT } });
        row.createEl('label', { text: 'Similar by' });
        const select = row.createEl('select', { cls: 'dropdown', attr: { 'data-option': 'similarityMode', 'aria-label': 'Similar by' } });
        for (const [mode, label] of Object.entries(SIMILARITY_MODE_LABELS)) select.createEl('option', { value: mode, text: label });
        select.addEventListener('change', () => {
            if (!isSimilarityMode(select.value) || select.value === settings.similarNotesMode) return;
            settings.similarNotesMode = select.value;
            this.persistSettings();
            this.controller.modeChanged();
        });
        return () => { select.value = settings.similarNotesMode; };
    }

    private buildShowListControl(container: HTMLElement): void {
        // The whole row is the label, so clicking the text toggles too (no DOM id to collide across panels).
        const row = container.createEl('label', {
            cls: ['seeker-map-tuning-row', 'is-inline'],
            attr: { title: 'Hide the list to see only the graph. You can also drag the line above the list to the bottom.' },
        });
        row.createSpan({ text: 'Show note list' });
        const input = row.createEl('input', { attr: { type: 'checkbox', 'data-option': 'showList', 'aria-label': 'Show note list' } });
        input.addEventListener('change', () => this.commitListSplit({ ...this.listSplit(), collapsed: !input.checked }));
        this.showListInput = input;
    }

    private persistSettings(): void {
        void this.deps.saveSettings().catch(e => this.reportFailure('similar-notes:save', e));
    }

    private reportFailure(context: string, e: unknown): void {
        void this.deps.logger.appendError(context, e).catch(() => {});
    }
}
