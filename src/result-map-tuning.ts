// The result map's tuning popover: live knobs for clustering + layout, opened from
// an icon in the map's header (cluster graph 3/3, plan:
// _tickets/plan-desktop-result-cluster-graph-beside-the-search-list.md). Lives in
// the map, NOT the settings tab, because tuning needs instant visual feedback.
// Bounds + defaults come from result-cluster-model.ts; this module only adds the
// copy, slider steps and value formatting. The graph (result-map-graph.ts) and
// its host own persistence and re-layout; the popover only reports new options.

import { setIcon } from 'obsidian';
import {
    CLUSTER_GRAPH_OPTION_LIMITS, DEFAULT_CLUSTER_GRAPH_OPTIONS,
    completeClusterGraphOptions, isRadiusMode, sameClusterGraphOptions,
    type ClusterGraphOptions, type NumericClusterGraphOption, type RadiusMode,
} from './result-cluster-model';

// ── control spec (pure) ─────────────────────────────────────────────────────

export interface TuningSliderSpec {
    key: NumericClusterGraphOption;
    label: string;
    // Tooltip: what moving it does, in the user's words.
    hint: string;
    step: number;
    format(value: number): string;
}

const STRENGTH_STEP = 0.05;
const STRENGTH_DECIMALS = 2;
const formatStrength = (v: number): string => v.toFixed(STRENGTH_DECIMALS);

export const CLUSTER_SLIDERS: readonly TuningSliderSpec[] = [
    {
        key: 'cutPercentile', label: 'Group cut', step: 1, format: v => `p${v}`,
        hint: 'Notes group when they are more alike than this percentile of this query’s note pairs. Higher = fewer, tighter groups.',
    },
    {
        key: 'neighbours', label: 'Links per note', step: 1, format: v => String(v),
        hint: 'Each note draws a line to its most similar results.',
    },
];

export const FORCE_SLIDERS: readonly TuningSliderSpec[] = [
    {
        key: 'radialStrength', label: 'Pull to relevance ring', step: STRENGTH_STEP, format: formatStrength,
        hint: 'How strongly a note keeps its distance from the centre (its relevance).',
    },
    {
        key: 'linkStrength', label: 'Pull between linked notes', step: STRENGTH_STEP, format: formatStrength,
        hint: 'How strongly linked (similar) notes draw together.',
    },
];

export const RADIUS_MODE_LABELS: Readonly<Record<RadiusMode, string>> = {
    rank: 'Rank',
    score: 'Score',
};

// The options after one control moved. Completed so a bad input value can never
// reach the model as NaN.
export function withOption<K extends keyof ClusterGraphOptions>(
    options: ClusterGraphOptions, key: K, value: ClusterGraphOptions[K],
): ClusterGraphOptions {
    return completeClusterGraphOptions({ ...options, [key]: value });
}

export function isDefaultTuning(options: ClusterGraphOptions): boolean {
    return sameClusterGraphOptions(options, DEFAULT_CLUSTER_GRAPH_OPTIONS);
}

// ── popover (DOM) ───────────────────────────────────────────────────────────

export interface TuningPopoverDeps {
    // The live tuning (the modal's: SeekerSettings.resultMapTuning).
    current(): ClusterGraphOptions;
    // A control moved: apply in memory + re-lay out. Fires per slider step while dragging.
    update(options: ClusterGraphOptions): void;
    // The user settled on a value (slider released, mode picked, reset): save it.
    persist(): void;
    // Closing the popover while a control has focus hands focus back to the host
    // (the modal: its query field).
    restoreFocus(): void;
}

interface SliderRow {
    spec: TuningSliderSpec;
    input: HTMLInputElement;
    valueEl: HTMLElement;
}

export class ResultMapTuningPopover {
    private readonly buttonEl: HTMLElement;
    private readonly el: HTMLElement;
    private readonly sliders: SliderRow[] = [];
    private readonly radiusSelect: HTMLSelectElement;
    private readonly resetButton: HTMLButtonElement;
    private isOpen = false;

    // `buttonParent` = the map header's right corner; `popoverParent` = the map panel
    // (the popover overlays the drawing, top right).
    constructor(buttonParent: HTMLElement, popoverParent: HTMLElement, private readonly deps: TuningPopoverDeps) {
        this.buttonEl = buttonParent.createEl('button', {
            cls: ['clickable-icon', 'seeker-map-tune'],
            attr: { type: 'button', 'aria-label': 'Tune map', 'aria-expanded': 'false' },
        });
        setIcon(this.buttonEl, 'sliders-horizontal');
        this.buttonEl.addEventListener('click', () => this.setOpen(!this.isOpen));

        this.el = popoverParent.createDiv({ cls: 'seeker-map-tuning', attr: { role: 'group', 'aria-label': 'Map tuning' } });
        this.el.createDiv({ cls: 'seeker-map-tuning-title', text: 'Map tuning' });
        for (const spec of CLUSTER_SLIDERS) this.sliders.push(this.buildSlider(spec));
        this.radiusSelect = this.buildRadiusSelect();
        for (const spec of FORCE_SLIDERS) this.sliders.push(this.buildSlider(spec));
        this.resetButton = this.el.createEl('button', { cls: 'seeker-map-tuning-reset', text: 'Reset to defaults', attr: { type: 'button' } });
        this.resetButton.addEventListener('click', () => {
            this.deps.update({ ...DEFAULT_CLUSTER_GRAPH_OPTIONS });
            this.deps.persist();
            this.sync();
        });
        this.setOpen(false);
    }

    // Is `target` one of the popover's sliders/dropdown? Only those need a mousedown
    // to focus them; the modal's map swallows every other mousedown. WHY-NOT the whole
    // popover: a click on its text or Reset button would move focus off the query
    // field (Reset then disables itself, dropping focus to the body).
    takesPointerFocus(target: EventTarget | null): boolean {
        return target instanceof Element && this.el.contains(target) && target.closest('input, select') !== null;
    }

    private setOpen(open: boolean): void {
        if (!open && this.el.contains(activeDocument.activeElement)) this.deps.restoreFocus();
        this.isOpen = open;
        this.el.toggle(open);
        this.buttonEl.setAttr('aria-expanded', String(open));
        this.buttonEl.toggleClass('is-active', open);
        if (open) this.sync();
    }

    private buildSlider(spec: TuningSliderSpec): SliderRow {
        const { min, max } = CLUSTER_GRAPH_OPTION_LIMITS[spec.key];
        const row = this.el.createDiv({ cls: 'seeker-map-tuning-row', attr: { title: spec.hint } });
        const head = row.createDiv({ cls: 'seeker-map-tuning-head' });
        head.createEl('label', { text: spec.label });
        const valueEl = head.createSpan({ cls: 'seeker-map-tuning-value' });
        const input = row.createEl('input', {
            cls: 'slider',
            attr: { type: 'range', min, max, step: spec.step, 'data-option': spec.key, 'aria-label': spec.label },
        });
        const slider: SliderRow = { spec, input, valueEl };
        // `input` fires per step while dragging (instant re-layout); `change` once on
        // release (one save per gesture, not one per step).
        input.addEventListener('input', () => {
            this.deps.update(withOption(this.deps.current(), spec.key, Number(input.value)));
            this.sync();
        });
        input.addEventListener('change', () => this.deps.persist());
        return slider;
    }

    private buildRadiusSelect(): HTMLSelectElement {
        const row = this.el.createDiv({
            cls: ['seeker-map-tuning-row', 'is-inline'],
            attr: { title: 'Rank = list order, evenly spaced. Score = relevance score; one strong top hit pushes the rest outward.' },
        });
        row.createEl('label', { text: 'Distance from centre by' });
        const select = row.createEl('select', { cls: 'dropdown', attr: { 'data-option': 'radiusMode', 'aria-label': 'Distance from centre by' } });
        for (const [mode, label] of Object.entries(RADIUS_MODE_LABELS)) select.createEl('option', { value: mode, text: label });
        select.addEventListener('change', () => {
            if (!isRadiusMode(select.value)) return;
            this.deps.update(withOption(this.deps.current(), 'radiusMode', select.value));
            this.deps.persist();
            this.sync();
        });
        return select;
    }

    // Paint the live options into every control (after open, a move, or a reset).
    private sync(): void {
        const options = this.deps.current();
        for (const { spec, input, valueEl } of this.sliders) {
            input.value = String(options[spec.key]);
            valueEl.setText(spec.format(options[spec.key]));
        }
        this.radiusSelect.value = options.radiusMode;
        this.resetButton.disabled = isDefaultTuning(options);
    }
}
