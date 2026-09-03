// src/settings-tab.ts — Seek's Settings tab.
//
// Redesigned 2026-06-19 (see plan "Seek — Settings Tab Redesign + Default
// Ratification"): an opinionated, status-led tab in place of the old flat debug
// surface. Section order is intentional — Index leads (the one operational concern),
// relevance recedes behind a disclosure fronted by a teaching pipeline diagram, and
// the model/compute story gets a home. Section IA, top→bottom:
//   Index → Relevance → Display → Model & performance → Reset → About
//
// Built native: Obsidian `Setting` rows + a few custom DOM helpers (segmented control,
// status card, pipeline diagram, progress row), all styled from theme CSS variables in
// styles.css so the tab absorbs the user's theme + dark mode. The validated debug knobs
// (prefix / synonym / headings / coverage / properties / boosted-BM25 / sidecar toggle)
// are now silent defaults and deliberately NOT surfaced — see DEFAULT_SETTINGS + the
// rev-5 migration in types.ts/main.ts.

import { App, PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import type SeekerPlugin from './main';
import type { IndexStats, ModelStatus, OcrStats } from './main';
import type { AltOpenLocation, SidecarIndexLocation, ModelOverride, Pooling, Dtype } from './types';
import { DEFAULT_SETTINGS, MATCH_STRENGTH_MIN_NOTES } from './types';
import {
    getBackendOverride, setBackendOverride, isWebgpuDemoted, clearWebgpuDemoted, getResolvedBackend, isMobilePlatform,
    type BackendChoice,
} from './platform';
import { shouldWarn, describeBackendLine } from './backend-warning';
import { enumerateDatePropertyNames } from './prop-types';
import { collectIndexableFiles } from './indexable-file';
import { ACTIVE_MODEL_SPEC } from './model-registry';
import { isValidHfSlug } from './model-candidate';
import type { ModelCandidate, ModelValidation } from './model-validate';

// Real repo/docs URLs for the About footer. Seeker is a fork of Obsidian-Seek;
// the docs still point at the original author's published guide (the fork ships
// no docs of its own yet), while the repository link is this fork's home.
const GITHUB_URL = 'https://github.com/nickolay-kondratyev/Obsidian-Seeker';
const DOCS_URL = 'https://publish.obsidian.md/rmm/Seek+Documentation/About+Seek';

// ISO-8601 local stamp (YYYY-MM-DD HH:MM) for the status card — the vault's date
// convention, replacing the locale "6/19/2026, 8:10:32 PM" the card showed before.
// Local components (not toISOString's UTC) so the time matches the user's clock;
// seconds are dropped as noise for a "last index" marker.
function fmtStamp(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Human bytes for the OCR cache line ("N images · M MB"). KB below a MB so a
// small cache reads honestly rather than "0.0 MB".
function fmtBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// (The date-property picker enumerator moved to prop-types.ts, shared with the
// typed-value inline filters — see enumerateDatePropertyNames import above.)

// ---- segmented (pill) stages ------------------------------------------------------
type Stage = 'Off' | 'Default' | 'High';

// Title bonus maps the navTitleBoost scalar onto three stages. The eval-swept knee is
// 0.8 (now reachable as High); the 2026-06-19 ratification ships Default=0.5 (see
// types.ts navTitleBoost). titleStageOf() snaps any persisted/off-grid value to the
// nearest stage so a hand-tuned legacy value still selects something sensible.
const TITLE_VALUE: Record<Stage, number> = { Off: 0, Default: 0.5, High: 0.8 };
function titleStageOf(v: number): Stage {
    let best: Stage = 'Default';
    for (const stage of ['Off', 'Default', 'High'] as Stage[]) {
        if (Math.abs(TITLE_VALUE[stage] - v) < Math.abs(TITLE_VALUE[best] - v)) best = stage;
    }
    return best;
}

// Recency bonus maps {recencyEpsilon, recencyHalfLifeDays} onto three stages. Off=ε0
// (ships Off), Default=0.04·180d, High=0.1·90d (see types.ts recencyEpsilon). ε≤0 is
// Off; otherwise snap to the nearer of Default/High by ε.
//
// High's half-life SHORTENS past Default (180→90) — it does not lengthen. High shipped
// at 270d through 2026-07-16, which made it inert at the thing it advertises: ε is the
// budget, but the half-life decides how much of that budget is spent in the age band
// the query actually spans. Live-vault measurement ("brian 1x1", ~40 dated siblings,
// full-series base hybrid+title spread 0.032): the today-vs-36d recency swing is 0.0088
// at 270d, so the newest sibling sat at rank 9 of its own series; at 90d it is 0.0242 —
// enough for rank 3, not rank 1, since 0.0242 is still under the series spread (it only
// has to beat the gap to each competitor, never the full range). ε was never the
// problem; 0.1 was already enough budget.
//
// High IS a lean, deliberately — types.ts recencyEpsilon says so, and that is why it is
// opt-in rather than the default. Over the competitive 0–100d band the 90d recency range
// (~0.054) exceeds the 0.032 sibling spread, so inside a dated series date now leads
// relevance. ranker.ts's "ε must NEVER become a lean" governs the always-on DEFAULT
// tiebreaker (ε 0.02, now 0), not this opt-in stage. 270 making High *gentler* than
// Default was the incoherence.
//
// 90 is anchored, not swept: the 06-04 click study's MEDIAN episodic click target is 83d
// old (see types.ts recencyHalfLifeDays), so the decay's knee sits on the click mass.
// Don't chase shorter. What a short half-life buys is how far a 0-day note outruns the
// pool's TYPICAL AGE — against a 60d note a brand-new one gains +0.014 at 270d but +0.075
// at 30d — so the shorter it gets, the more a fresh note overtakes a hybrid deficit it
// never earned. (The term's total range over 0–730d is ~0.085–0.100 at EVERY half-life,
// so that number tells you nothing; the advantage over the pool's real age mass is the
// one that moves ranks.) Swept live on a FLAT no-opinion pool — a query nothing matches:
// purely topical through 180d, one recent intruder at 120–60d, intruder at rank 2 by 45d,
// and at 30d today's notes displace the topical results outright, which is the 30d-cutoff
// bug the smooth decay replaced. A monotonic slide, not a cliff: 90 buys the dated-series
// fix while a flat pool stays essentially topical. See [[seeker-recency-halflife-high-mode]].
const RECENCY_VALUE: Record<Stage, { eps: number; hl: number }> = {
    Off: { eps: 0, hl: 180 },
    Default: { eps: 0.04, hl: 180 },
    High: { eps: 0.1, hl: 90 },
};
function recencyStageOf(eps: number): Stage {
    if (eps <= 0) return 'Off';
    return Math.abs(eps - RECENCY_VALUE.Default.eps) <= Math.abs(eps - RECENCY_VALUE.High.eps) ? 'Default' : 'High';
}

// Search strategy: Balanced (denseWeight 0.8) vs Keyword focused (0.3). Concept-focused
// (0.9) was cut. Split at the midpoint so a legacy denseWeight still resolves a side.
type Strategy = 'balanced' | 'keyword';
const STRATEGY_VALUE: Record<Strategy, number> = { balanced: 0.8, keyword: 0.3 };
function strategyOf(denseWeight: number): Strategy {
    return denseWeight <= 0.55 ? 'keyword' : 'balanced';
}

// ---- Advanced model settings label maps -------------------------------------------
// Precision = the user-facing name for a model's ONNX dtype. Only the three widely
// exported dtypes are offered (q4f16 exists in the Dtype union but is a rarely-shipped
// WebGPU variant — not a sensible manual choice). Ordered smallest→largest so the row
// reads as a size ladder.
const PRECISION_OPTIONS: { value: Extract<Dtype, 'q4' | 'q8' | 'fp32'>; label: string }[] = [
    { value: 'q4', label: 'q4 (smallest, default)' },
    { value: 'q8', label: 'q8' },
    { value: 'fp32', label: 'fp32 (largest)' },
];
const POOLING_LABEL: Record<Pooling, string> = { cls: 'CLS', mean: 'Mean' };
// The compute device the validation load actually ran on, in the user's vocabulary
// (matches the Compute segmented control: WASM is "CPU").
const DEVICE_LABEL: Record<'webgpu' | 'wasm', string> = { webgpu: 'WebGPU', wasm: 'CPU' };

export class SeekerSettingTab extends PluginSettingTab {
    // Async index/model snapshots, loaded once per tab open (guarded null→fetch→re-render).
    private stats: IndexStats | null = null;
    private modelStatus: ModelStatus | null = null;
    private loading = false;
    // UI state that must survive the synchronous display() re-renders triggered by
    // segmented picks and the reindex state machine.
    private advancedOpen = false;
    // Independent of advancedOpen (Relevance) so the Index disclosure toggles on its own.
    private indexAdvancedOpen = false;
    private reindexPhase: 'idle' | 'confirm' | 'running' = 'idle';
    private reindexDone = 0;
    private reindexTotal = 0;
    // Live-progress DOM refs, repointed on each display() so the runFullReindex
    // onProgress callback always paints the current node (robust to close/reopen).
    private progressFillEl: HTMLElement | null = null;
    private progressLabelEl: HTMLElement | null = null;
    // Transient "downloading…" flag for the model section (no byte progress available).
    private modelDownloading = false;
    // Model-delete state: two-step confirm (Delete → Cancel / Delete model) so a
    // destructive ~100 MB cache wipe can't fire on a single click, plus an in-progress
    // flag for the "Deleting…" feedback. Both reset on hide() so reopening is clean.
    private modelDeleteConfirm = false;
    private modelDeleting = false;
    // Advanced model settings (user-selectable embedding model). The disclosure's
    // own open-state, plus LOCAL tab state that is NOT persisted until Switch:
    // `candidate` holds the in-progress field values (seeded lazily from the active
    // override, or the shipped default when none), and `validation` is the last
    // Validate result. `validation` is cleared on ANY field edit so "Switch" is only
    // ever enabled for the exact values that were validated. Saving on keystroke is
    // deliberately avoided — the override is synced and drives every device's index
    // identity, so it may only change through validate-then-switch.
    private modelAdvancedOpen = false;
    private candidate: ModelCandidate | null = null;
    private validation: ModelValidation | null = null;
    private validating = false;
    private modelSwitchConfirm = false;
    private modelResetConfirm = false;
    private repoError: string | null = null;
    // Generation counter for in-flight Validate calls: invalidateValidation() bumps it,
    // and a Validate result is only accepted when the generation it started under is
    // still current. Without it a result could land AFTER the fields it validated were
    // edited (or the tab was hidden and reseeded) and re-enable Switch for values that
    // were never validated.
    private validationSeq = 0;
    // The repo value the last blur/Enter commit ran for. Blur fires on every focus
    // loss, edited or not, so commitRepo() only acts when the repo actually changed —
    // otherwise clicking into the field and straight onto Validate/Switch would
    // re-run pooling detection for nothing.
    private committedRepo: string | null = null;
    // Hint under the Pooling dropdown after a repo edit: whether the repo declared its
    // pooling ("Detected from the repo") or not ("… pick manually"). Null = no hint yet.
    private poolingHint: string | null = null;
    // OCR (image indexing) snapshot + button state. Same open-once + two-step
    // destructive-confirm pattern as the model section.
    private ocrStats: OcrStats | null = null;
    private ocrClearConfirm = false;
    private ocrClearing = false;
    private ocrRebuilding = false;

    constructor(app: App, private plugin: SeekerPlugin) {
        super(app, plugin);
    }

    display(): void {
        // Fetch the async snapshots once; re-render when they land.
        if (!this.stats && !this.loading) void this.loadData();

        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('seeker-settings');

        this.renderBackendLine(containerEl);
        this.renderIndex(containerEl);
        this.renderRelevance(containerEl);
        this.renderDisplay(containerEl);
        this.renderModel(containerEl);
        this.renderReset(containerEl);
        this.renderAbout(containerEl);
    }

    // A full display() is the simplest way to reflect cross-control dependencies (the
    // pipeline diagram reacting to strategy, the date picker enabling with recency, the
    // reindex state machine). But empty()+rebuild resets the scroll container to the top,
    // which on a long tab — especially the full-screen mobile settings — yanks the user
    // away from the control they just tapped. rerender() preserves the scroll offset
    // across the rebuild, so every segmented pick / disclosure toggle stays put. All
    // interaction-driven re-renders go through here; only Obsidian's initial display()
    // (which opens at the top anyway) calls display() directly.
    private rerender(): void {
        const scroller = this.findScroller();
        const top = scroller ? scroller.scrollTop : 0;
        this.display();
        if (scroller) scroller.scrollTop = top;
    }

    // Nearest scrollable ancestor (containerEl included). The settings scroll container
    // differs between desktop (.vertical-tab-content) and mobile, so we detect it by
    // overflow rather than hardcoding a selector. Null if nothing scrolls (short tab).
    private findScroller(): HTMLElement | null {
        let el: HTMLElement | null = this.containerEl;
        while (el) {
            if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible') return el;
            el = el.parentElement;
        }
        return null;
    }

    // Reset the per-open snapshots so the next open re-fetches fresh counts/last-index.
    hide(): void {
        this.stats = null;
        this.modelStatus = null;
        this.ocrStats = null;
        this.modelDeleteConfirm = false;
        this.ocrClearConfirm = false;
        this.resetConfirm = false;
        // Discard the in-progress model candidate + confirm state so reopening the tab
        // reseeds from the (possibly just-switched) active model, never a stale draft.
        this.discardCandidate();
    }

    private async loadData(): Promise<void> {
        this.loading = true;
        try {
            const [stats, modelStatus, ocrStats] = await Promise.all([
                this.plugin.getIndexStats(),
                this.plugin.getModelStatus(),
                this.plugin.getOcrStats(),
            ]);
            this.stats = stats;
            this.modelStatus = modelStatus;
            this.ocrStats = ocrStats;
        } finally {
            this.loading = false;
        }
        this.rerender();
    }

    private get s() { return this.plugin.settings; }
    private save = () => this.plugin.saveSettings();

    // ---- Compute backend line (top of tab) -----------------------------------------
    // Permanent "Running on: …" line. Amber warning when the user asked for the GPU
    // (Auto / Force WebGPU) but the last load landed on CPU — the "setting says
    // WebGPU, plugin silently runs WASM" gap. Reads the per-device record of the LAST
    // load (platform.ts getResolvedBackend); before any load this session that is the
    // previous session's outcome, or "not loaded yet" on a fresh device. Decision +
    // copy live in backend-warning.ts so the reindex-start toast in main.ts agrees.
    private renderBackendLine(containerEl: HTMLElement): void {
        const override = getBackendOverride();
        const resolved = getResolvedBackend();
        const mobile = isMobilePlatform();
        const warn = shouldWarn(override, resolved, mobile).warn;
        const line = containerEl.createDiv({ cls: warn ? 'seeker-inline-warn seeker-backend-line' : 'seeker-backend-line' });
        line.setText(describeBackendLine(override, resolved, mobile));
    }

    // ---- Index ---------------------------------------------------------------------
    private statusState(): 'none' | 'ok' | 'indexing' | 'error' {
        if (this.plugin.isIndexing || this.reindexPhase === 'running') return 'indexing';
        if (this.plugin.indexHealthState === 'degraded') return 'error';
        if (this.plugin.indexHealthState === 'recovering') return 'indexing';
        if (this.stats && this.stats.files === 0) return 'none';
        return 'ok'; // NOTE: 'stale' (vault edited since last index) is intentionally
                     // not derived — it needs an expensive delta scan, and the file
                     // watcher catches edits up automatically. See the plan's degradations.
    }

    private renderIndex(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Index').setHeading();

        this.renderStatusCard(containerEl);

        if (this.plugin.indexHealthState === 'degraded') {
            const warn = containerEl.createDiv({ cls: 'seeker-inline-warn' });
            warn.setText('Index degraded — search still works but ranking may be off. A full reindex is recommended.');
        }

        // The reindex button + live progress bar stay outside the disclosure: it's the
        // primary action and must be visible regardless of the advanced toggle.
        this.renderReindexRow(containerEl);

        // Advanced disclosure — what to index (Bases / excluded folders) and where the
        // index lives are set-once knobs, so tuck them away like Relevance's advanced
        // section. Mirrors renderRelevance's disclosure, with its own open-state flag.
        const disc = containerEl.createDiv({ cls: 'seeker-disclosure' });
        disc.createSpan({ cls: 'seeker-disclosure-chev', text: this.indexAdvancedOpen ? '▾' : '▸' });
        disc.createSpan({ text: 'Advanced settings' });
        disc.onclick = () => { this.indexAdvancedOpen = !this.indexAdvancedOpen; this.rerender(); };

        if (this.indexAdvancedOpen) this.renderIndexAdvanced(containerEl);
    }

    private renderIndexAdvanced(containerEl: HTMLElement): void {
        const adv = containerEl.createDiv({ cls: 'seeker-adv' });

        new Setting(adv)
            .setName('Index Base files')
            .setDesc('Include your Obsidian Bases (.base files) in the search index, so a Base shows up by its name and filters. Takes effect on the next full reindex.')
            .addToggle(t => t.setValue(this.s.indexBases).onChange(async v => { this.s.indexBases = v; await this.save(); }));

        new Setting(adv)
            .setName('Index Canvas files')
            .setDesc('Include your Canvas boards (.canvas files) in the search index, so a canvas shows up by its cards, group names and links. Takes effect on the next catch-up sweep.')
            .addToggle(t => t.setValue(this.s.indexCanvases).onChange(async v => { this.s.indexCanvases = v; await this.save(); }));

        this.renderOcr(adv);

        new Setting(adv)
            .setName('Honor excluded folders')
            .setDesc("Skip files in Obsidian's Settings → Files & Links → Excluded files (e.g. Archive). Takes effect on the next full reindex.")
            .addToggle(t => t.setValue(this.s.honorIgnoredFolders).onChange(async v => { this.s.honorIgnoredFolders = v; await this.save(); }));

        // Built as DOM (intro line · two bullets · footer) rather than a setDesc() string,
        // which renders flat with no line breaks — the two location options read far more
        // clearly as a short list.
        const indexLoc = new Setting(adv).setName('Index location');
        indexLoc.descEl.createDiv({ text: 'This is where the synced index folder lives.' });
        const locList = indexLoc.descEl.createEl('ul', { cls: 'seeker-desc-list' });
        const locHidden = locList.createEl('li');
        locHidden.createEl('strong', { text: 'Hidden (default): ' });
        // Literal '.obsidian', NOT vault.configDir: the sidecar index is pinned to
        // the default config folder so every device resolves the SAME synced path
        // (see main.ts sidecarConfigDir). Showing vault.configDir would misreport
        // the index location to a renamed-config user, whose index still lives here.
        locHidden.createSpan({ text: `inside the hidden .obsidian config folder.` });
        const locRoot = locList.createEl('li');
        locRoot.createEl('strong', { text: 'Vault root: ' });
        locRoot.createSpan({ text: 'a visible "Seeker Index" folder will appear in your vault. Choose this only if you use Obsidian Sync with a mobile or tablet override config folder.' });
        indexLoc.descEl.createDiv({ text: 'Takes effect after reloading Seeker.' });
        indexLoc.addDropdown(dd => dd
            .addOption('config', `Hidden (.obsidian, recommended)`)
            .addOption('visible', 'Vault root (Seeker Index/)')
            .setValue(this.s.sidecarIndexLocation)
            .onChange(async v => {
                this.s.sidecarIndexLocation = v as SidecarIndexLocation;
                await this.save();
                new Notice('Seeker: index location changed — reload Seeker (or restart Obsidian) for it to take effect.', 8000);
            }));
    }

    // Image OCR (docs/research/image-ocr.md §12 D8): the opt-in toggle, the
    // language packs, a cache-status line, and the Clear / Rebuild actions. Clear
    // is ALWAYS shown (also with OCR off — it frees the synced space); Rebuild
    // only while OCR is on. `ocrStats` is the async snapshot from loadData().
    private renderOcr(container: HTMLElement): void {
        const ocr = this.ocrStats;
        const cacheDir = ocr ? ocr.cacheDir : '<index>/ocr';

        const toggle = new Setting(container).setName('Index text in images (OCR)');
        toggle.descEl.createDiv({ text: 'Search inside screenshots and images (png, jpg, webp, gif, bmp) by reading their text with on-device OCR. Off by default.' });
        toggle.descEl.createDiv({ text: 'A desktop does the OCR; phones and tablets search the results but never run the engine — they read the text a desktop already OCR’d and synced.' });
        toggle.descEl.createDiv({ text: `Extracted text is cached one file per image under ${cacheDir}/ and syncs with your vault, so each image is OCR’d only once across all your devices.` });
        toggle.addToggle(t => t.setValue(this.s.indexImages).onChange(async v => {
            this.s.indexImages = v;
            await this.save();
            this.plugin.onOcrSettingsChanged();
            new Notice(v
                ? 'Seeker: image OCR enabled — a desktop will index images in the background.'
                : 'Seeker: image OCR disabled. Existing OCR text stays cached; use "Clear OCR cache" to free the space.', 6000);
            this.ocrStats = null;
            this.rerender();
            void this.loadData();
        }));

        // Language packs — a text field of tesseract codes; only while OCR is on.
        if (this.s.indexImages) {
            const shownLangs = (ocr ? ocr.langs : this.s.ocrLangs).join(' ');
            const langs = new Setting(container).setName('OCR languages');
            langs.descEl.createDiv({ text: 'Space-separated tesseract language codes (e.g. "eng deu fra"). Each pack downloads once from jsdelivr and is cached like the model. Leave blank to auto-pick your Obsidian language plus English.' });
            langs.descEl.createDiv({ text: 'Changing this never re-OCRs images already in the cache — it only affects images OCR’d from now on. Use "Rebuild OCR cache" to re-OCR everything.' });
            langs.addText(t => {
                t.setPlaceholder('eng');
                t.setValue(shownLangs);
                t.onChange(async val => {
                    // [] = auto (Obsidian locale + eng). Parsed on every keystroke;
                    // the engine is only re-wired on blur (below) to avoid churn.
                    this.s.ocrLangs = val.split(/[\s,]+/).map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
                    await this.save();
                });
                t.inputEl.addEventListener('blur', () => this.plugin.onOcrSettingsChanged());
            });
        }

        // Cache status: count + size, skipped formats, waiting-for-desktop (mobile).
        const status = container.createDiv({ cls: 'seeker-ocr-status' });
        if (ocr) {
            status.createDiv({ text: `OCR cache: ${ocr.cacheCount.toLocaleString()} image${ocr.cacheCount === 1 ? '' : 's'} · ${fmtBytes(ocr.cacheBytes)}` });
            if (ocr.skippedHeic > 0 || ocr.skippedSvg > 0) {
                const parts: string[] = [];
                if (ocr.skippedHeic > 0) parts.push(`${ocr.skippedHeic} HEIC`);
                if (ocr.skippedSvg > 0) parts.push(`${ocr.skippedSvg} SVG`);
                status.createDiv({ text: `Not OCR-able, skipped: ${parts.join(', ')}.` });
            }
            if (!ocr.desktop && ocr.waiting > 0) {
                status.createDiv({ text: `Waiting for OCR from a desktop: ${ocr.waiting} image${ocr.waiting === 1 ? '' : 's'}.` });
            }
        } else {
            status.createDiv({ text: 'OCR cache: …' });
        }

        // Clear — ALWAYS shown (also with OCR off), two-step confirm; the count +
        // size sit beside it so a user knows what they are freeing.
        const clearDesc = ocr && ocr.cacheCount > 0
            ? `Delete all ${ocr.cacheCount.toLocaleString()} cached OCR records (${fmtBytes(ocr.cacheBytes)}) and drop image results from the index.`
            : 'Delete every cached OCR record and drop image results from the index.';
        const clearRow = new Setting(container).setName('Clear OCR cache').setDesc(clearDesc);
        if (this.ocrClearConfirm) {
            clearRow.addButton(b => b.setButtonText('Cancel').onClick(() => { this.ocrClearConfirm = false; this.rerender(); }));
            clearRow.addButton(b => b.setButtonText('Clear').setWarning().onClick(() => this.clearOcr()));
        } else {
            clearRow.addButton(b => b.setButtonText(this.ocrClearing ? 'Clearing…' : 'Clear')
                .setWarning().setDisabled(this.ocrClearing)
                .onClick(() => { this.ocrClearConfirm = true; this.rerender(); }));
        }

        // Rebuild — only while OCR is on (Clear + a catch-up re-OCR).
        if (this.s.indexImages) {
            new Setting(container).setName('Rebuild OCR cache')
                .setDesc('Clear the cache and re-OCR every image with the current engine and languages. Runs in the background on this desktop.')
                .addButton(b => b.setButtonText(this.ocrRebuilding ? 'Rebuilding…' : 'Rebuild')
                    .setDisabled(this.ocrRebuilding)
                    .onClick(() => this.rebuildOcr()));
        }
    }

    private clearOcr(): void {
        this.ocrClearConfirm = false;
        this.ocrClearing = true;
        this.rerender();
        void this.plugin.clearOcrCache().then(r => {
            new Notice(`Seeker: OCR cache cleared${r.imagesDropped > 0 ? ` — ${r.imagesDropped} image result${r.imagesDropped === 1 ? '' : 's'} dropped from the index` : ''}.`, 6000);
        }).catch(e => {
            new Notice(`Seeker: clearing the OCR cache failed — ${e instanceof Error ? e.message : String(e)}`, 8000);
        }).finally(() => {
            this.ocrClearing = false;
            this.ocrStats = null;
            this.rerender();
            void this.loadData();
        });
    }

    private rebuildOcr(): void {
        this.ocrRebuilding = true;
        this.rerender();
        void this.plugin.rebuildOcrCache().then(() => {
            new Notice('Seeker: rebuilding the OCR cache — images re-index in the background.', 6000);
        }).catch(e => {
            new Notice(`Seeker: rebuilding the OCR cache failed — ${e instanceof Error ? e.message : String(e)}`, 8000);
        }).finally(() => {
            this.ocrRebuilding = false;
            this.ocrStats = null;
            this.rerender();
            void this.loadData();
        });
    }

    private renderStatusCard(containerEl: HTMLElement): void {
        const card = containerEl.createDiv({ cls: 'seeker-status-card' });

        const STATE: Record<string, { tone: string; label: string }> = {
            none: { tone: 'mid', label: 'No index' },
            ok: { tone: 'good', label: 'Up to date' },
            indexing: { tone: 'accent', label: 'Indexing…' },
            error: { tone: 'bad', label: 'Index error' },
        };
        const st = STATE[this.statusState()];

        const health = card.createDiv({ cls: 'seeker-status-health' });
        health.createSpan({ cls: `seeker-dot seeker-dot-${st.tone}` });
        health.createSpan({ cls: 'seeker-status-label', text: st.label });

        card.createDiv({ cls: 'seeker-status-sep' });

        const metric = (value: string, label: string) => {
            const m = card.createDiv({ cls: 'seeker-status-metric' });
            m.createDiv({ cls: 'seeker-status-value', text: value });
            m.createDiv({ cls: 'seeker-status-mlabel', text: label });
        };
        const n = (x: number) => x.toLocaleString();
        if (this.stats) {
            metric(n(this.stats.files), 'files');
            metric(n(this.stats.chunks), 'chunks');
            // Storage figures intentionally omitted from this card: index size isn't shown
            // in settings anymore (the seeker:indexsize CLI still reports it for diagnostics),
            // and the model's on-disk size now lives in the Model & performance section.
            const last = card.createDiv({ cls: 'seeker-status-metric seeker-status-last' });
            if (this.stats.lastFullAt) {
                // Real full reindex: stamp + duration from the same run.
                const dur = this.stats.lastFullDurationMs != null
                    ? ` · ${(this.stats.lastFullDurationMs / 1000).toFixed(1)}s` : '';
                last.createDiv({ cls: 'seeker-status-mlabel', text: 'last full index' });
                last.createDiv({ cls: 'seeker-status-value seeker-status-stamp', text: `${fmtStamp(this.stats.lastFullAt)}${dur}` });
                // A catch-up has run since the full reindex → show it faintly so the full
                // stamp is never confused with an incremental update.
                if (this.stats.lastUpdatedAt && this.stats.lastUpdatedAt > this.stats.lastFullAt) {
                    last.createDiv({ cls: 'seeker-status-updated', text: `updated ${fmtStamp(this.stats.lastUpdatedAt)}` });
                }
            } else if (this.stats.lastUpdatedAt) {
                // No full reindex survives in the log — show the last update, no duration
                // (a catch-up's duration isn't meaningful to surface on its own).
                last.createDiv({ cls: 'seeker-status-mlabel', text: 'last updated' });
                last.createDiv({ cls: 'seeker-status-value seeker-status-stamp', text: fmtStamp(this.stats.lastUpdatedAt) });
            } else {
                last.createDiv({ cls: 'seeker-status-mlabel', text: 'last full index' });
                last.createDiv({ cls: 'seeker-status-value seeker-status-stamp', text: 'never' });
            }
        } else {
            metric('…', 'loading');
        }
    }

    private renderReindexRow(containerEl: HTMLElement): void {
        if (this.reindexPhase === 'running') {
            const row = containerEl.createDiv({ cls: 'seeker-progress-row' });
            const head = row.createDiv({ cls: 'seeker-progress-head' });
            head.createDiv({ cls: 'setting-item-name', text: 'Reindexing…' });
            this.progressLabelEl = head.createDiv({ cls: 'seeker-progress-count' });
            const bar = row.createDiv({ cls: 'seeker-progress-track' });
            this.progressFillEl = bar.createDiv({ cls: 'seeker-progress-fill' });
            this.paintProgress();
            return;
        }
        this.progressFillEl = null;
        this.progressLabelEl = null;

        if (this.reindexPhase === 'confirm') {
            new Setting(containerEl)
                .setName('Full reindex')
                .setDesc("This deletes the current index and re-indexes every note. This may take a few minutes, depending on the size of your vault. Search keeps working on the old index until it's complete.")
                .addButton(b => b.setButtonText('Cancel').onClick(() => { this.reindexPhase = 'idle'; this.rerender(); }))
                .addButton(b => b.setButtonText('Delete & reindex').setWarning().onClick(() => this.startReindex()));
            this.renderReindexNote(containerEl);
            return;
        }

        // No index yet (fresh install / post-reset): there's nothing to delete, so the
        // destructive "Delete & reindex" double-confirm is just friction. Offer a single
        // non-warning click that builds the index straight away.
        if (this.statusState() === 'none') {
            new Setting(containerEl)
                .setName('Build index')
                .setDesc('Index every note so Seeker can search your vault. This may take a few minutes on a large vault.')
                .addButton(b => b.setButtonText('Build index').setCta().onClick(() => this.startReindex()));
            this.renderReindexNote(containerEl);
            return;
        }

        new Setting(containerEl)
            .setName('Full reindex')
            .setDesc('Rebuild the whole search index from scratch.')
            .addButton(b => b.setButtonText('Reindex…').setWarning().onClick(() => { this.reindexPhase = 'confirm'; this.rerender(); }));
        this.renderReindexNote(containerEl);
    }

    // Building/reindexing re-embeds every note — the heaviest thing Seek does. On a
    // mobile phone that pass can be interrupted by the OS under memory pressure, so we
    // surface a standing note: run it on a computer and the phone syncs the finished
    // index embed-free. Shown on every device (it documents the limitation); tablets
    // are NOT called out — they handle the build fine.
    private renderReindexNote(containerEl: HTMLElement): void {
        containerEl.createDiv({
            cls: 'seeker-hint',
            text: 'Building the index re-embeds every note and isn’t recommended on a mobile phone. Run it on a computer, and your phone will sync the finished index automatically.',
        });
    }

    private startReindex(): void {
        this.reindexTotal = collectIndexableFiles(this.app.vault, this.s).length;
        this.reindexDone = 0;
        this.reindexPhase = 'running';
        this.rerender();

        void this.plugin.runFullReindex({
            skipConfirm: true,
            onProgress: (msg) => this.onReindexProgress(msg),
        }).then(() => {
            // Back to idle with a refreshed status card — that IS the "done" feedback.
            this.reindexPhase = 'idle';
            this.stats = null;
            this.rerender();
            void this.loadData();
        }).catch(() => {
            this.reindexPhase = 'idle';
            this.rerender();
        });
    }

    // Progress sink shared by every reindex-driving action (full reindex, model switch):
    // the plugin reports "Indexed N files" lines; the count drives the inline bar.
    private onReindexProgress(msg: string): void {
        const m = msg.match(/Indexed\s+([\d,]+)\s+files/i);
        if (m) this.reindexDone = parseInt(m[1].replace(/,/g, ''), 10);
        this.paintProgress();
    }

    private paintProgress(): void {
        const pct = this.reindexTotal > 0
            ? Math.min(100, Math.round((this.reindexDone / this.reindexTotal) * 100))
            : 0;
        if (this.progressFillEl) this.progressFillEl.style.width = `${pct}%`;
        if (this.progressLabelEl) {
            this.progressLabelEl.setText(`${this.reindexDone.toLocaleString()} / ${this.reindexTotal.toLocaleString()} notes · ${pct}%`);
        }
    }

    // ---- Relevance -----------------------------------------------------------------
    private renderRelevance(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Relevance').setHeading();

        const intro = containerEl.createDiv({ cls: 'seeker-rel-intro' });
        intro.createDiv({ cls: 'seeker-rel-title', text: 'How Seeker ranks' });
        intro.createDiv({
            cls: 'setting-item-description',
            text: 'Seeker blends conceptual meaning with exact keywords, and can optionally apply bonuses for recency and exact title matching. It is strongly recommended to leave Seeker in the default Balanced mode.',
        });

        this.renderPipeline(containerEl);

        containerEl.createDiv({ cls: 'seeker-hint', text: 'Relevance changes apply to your next search.' });

        // Advanced disclosure
        const disc = containerEl.createDiv({ cls: 'seeker-disclosure' });
        disc.createSpan({ cls: 'seeker-disclosure-chev', text: this.advancedOpen ? '▾' : '▸' });
        disc.createSpan({ text: 'Advanced relevance settings' });
        disc.onclick = () => { this.advancedOpen = !this.advancedOpen; this.rerender(); };

        if (this.advancedOpen) this.renderAdvanced(containerEl);
    }

    private renderPipeline(containerEl: HTMLElement): void {
        const strategy = strategyOf(this.s.denseWeight);
        const recStage = recencyStageOf(this.s.recencyEpsilon);
        const titleStage = titleStageOf(this.s.navTitleBoost);

        const pipe = containerEl.createDiv({ cls: 'seeker-pipe' });
        const box = (text: string, cls = '') => pipe.createDiv({ cls: `seeker-pipe-box ${cls}`.trim(), text });
        const arrow = () => pipe.createSpan({ cls: 'seeker-pipe-arrow', text: '→' });

        box('Notes');
        arrow();
        // In Balanced both branches are neutral; only Keyword-focused elevates Keyword.
        const branch = pipe.createDiv({ cls: 'seeker-pipe-branch' });
        branch.createDiv({ cls: 'seeker-pipe-box seeker-pipe-dense', text: 'Conceptual meaning' });
        branch.createDiv({ cls: `seeker-pipe-box seeker-pipe-kw${strategy === 'keyword' ? ' is-elevated' : ''}`, text: 'Keyword' });
        arrow();
        box('Fusion', 'seeker-pipe-fuse');
        arrow();
        // Bonuses with recency·title sub-labels: dim+strike when Off, bold when on, bolder at High.
        const bonus = pipe.createDiv({ cls: 'seeker-pipe-box seeker-pipe-bonus' });
        bonus.createSpan({ text: 'Bonuses' });
        const subs = bonus.createDiv({ cls: 'seeker-pipe-subs' });
        const subLabel = (text: string, stage: Stage) => {
            const cls = stage === 'Off' ? 'is-off' : stage === 'High' ? 'is-high' : 'is-on';
            subs.createSpan({ cls: `seeker-pipe-sub ${cls}`, text });
        };
        subLabel('recency', recStage);
        subs.createSpan({ text: ' · ' });
        subLabel('title', titleStage);
        arrow();
        box('Results');
    }

    private renderAdvanced(containerEl: HTMLElement): void {
        const adv = containerEl.createDiv({ cls: 'seeker-adv' });

        // Search strategy (denseWeight)
        const strat = new Setting(adv)
            .setName('Search strategy')
            .setDesc('Balanced suits nearly everyone. Only switch to Keyword focused if you have exact terms which Balanced mode does not rank appropriately.');
        this.addSegmented(strat, ['Balanced', 'Keyword focused'],
            strategyOf(this.s.denseWeight) === 'keyword' ? 'Keyword focused' : 'Balanced',
            (pick) => {
                void (async () => {
                    this.s.denseWeight = STRATEGY_VALUE[pick === 'Keyword focused' ? 'keyword' : 'balanced'];
                    await this.save();
                    this.rerender(); // re-weight the pipeline diagram
                })();
            });

        // Fuzzy matching
        new Setting(adv)
            .setName('Fuzzy matching')
            .setDesc('Keywords will still return results even with small spelling mistakes.')
            .addToggle(t => t.setValue(this.s.fuzzyEnabled).onChange(async v => { this.s.fuzzyEnabled = v; await this.save(); }));

        // Recency bonus (3-stage) + date picker
        const recStage = recencyStageOf(this.s.recencyEpsilon);
        const rec = new Setting(adv)
            .setName('Recency bonus')
            .setDesc('Gives a score bonus to newer notes based on a selected date type property, or file modified date. This is recommended if you have episodic notes which occur regularly around the same topics, like meetings or classes.');
        this.addSegmented(rec, ['Off', 'Default', 'High'], recStage, (pick) => {
            void (async () => {
                const v = RECENCY_VALUE[pick as Stage];
                this.s.recencyEpsilon = v.eps;
                this.s.recencyHalfLifeDays = v.hl;
                await this.save();
                this.rerender(); // re-bold the pipeline "recency" sub-label + enable/disable the date picker
            })();
        });
        // Date-property picker, dimmed/disabled until a stage other than Off is chosen.
        const dateProps = enumerateDatePropertyNames(this.app);
        if (this.s.recencyKey === 'created' && !dateProps.includes(this.s.createdProp)) dateProps.unshift(this.s.createdProp);
        rec.addDropdown(dd => {
            for (const p of dateProps) dd.addOption(`prop:${p}`, `Property: ${p}`);
            dd.addOption('mtime', 'File modified time');
            dd.setValue(this.s.recencyKey === 'modified' ? 'mtime' : `prop:${this.s.createdProp}`);
            dd.onChange(async v => {
                if (v === 'mtime') { this.s.recencyKey = 'modified'; }
                else { this.s.recencyKey = 'created'; this.s.createdProp = v.slice('prop:'.length); }
                await this.save();
            });
            dd.selectEl.disabled = recStage === 'Off';
            if (recStage === 'Off') dd.selectEl.addClass('seeker-dimmed');
        });

        // Title bonus (3-stage)
        const title = new Setting(adv)
            .setName('Title bonus')
            .setDesc("Gives a score bonus to notes which have matching terms in their title. This can help a note that represents an entity or topic outrank pages that merely mention it.");
        this.addSegmented(title, ['Off', 'Default', 'High'], titleStageOf(this.s.navTitleBoost), (pick) => {
            void (async () => {
                this.s.navTitleBoost = TITLE_VALUE[pick as Stage];
                await this.save();
                this.rerender(); // re-bold the pipeline "title" sub-label
            })();
        });
    }

    // ---- Display -------------------------------------------------------------------
    private renderDisplay(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Display').setHeading();

        // Per-result score line. Match strength only exists on a calibrated corpus
        // (≥ MATCH_STRENGTH_MIN_NOTES notes AND a completed full-index pass that
        // produced dense background stats), so the toggle is shown always — for
        // discoverability — but disabled with a reason until scoring is possible.
        const noteCount = this.app.vault.getMarkdownFiles().length;
        const scoringReady = noteCount >= MATCH_STRENGTH_MIN_NOTES && (this.stats?.calibrated ?? false);
        const scoresDesc = scoringReady
            ? 'Shows each result’s Matching %, recency, and title boost on the result row.'
            : noteCount < MATCH_STRENGTH_MIN_NOTES
                ? `Shows each result’s Matching %, recency, and title boost. Needs at least ${MATCH_STRENGTH_MIN_NOTES} indexed notes before scores can be calibrated.`
                : 'Shows each result’s Matching %, recency, and title boost. Available once the index finishes its first full calibration pass.';
        new Setting(containerEl)
            .setName('Display scores')
            .setDesc(scoresDesc)
            .addToggle(t => t
                .setValue(this.s.showScores)
                .setDisabled(!scoringReady)
                .onChange(async v => { this.s.showScores = v; await this.save(); }));

        new Setting(containerEl)
            .setName('Keyboard hints bar')
            .setDesc('Displays a keyboard hint bar under results in the results modal.')
            .addToggle(t => t.setValue(this.s.showHotkeyHints).onChange(async v => { this.s.showHotkeyHints = v; await this.save(); }));

        // Alt-open destination. A plain Enter/click always replaces the current
        // tab (the quick-switcher contract; not configurable) — this picks where
        // the ⌘/Ctrl alt-open fans out instead. Mobile coerces to a tab at the
        // use-site (search-modal.ts altOpenTarget), so no per-platform gating here.
        const ALT_OPEN_VALUE: Record<string, AltOpenLocation> = {
            'New tab': 'tab', 'New split': 'split', 'New window': 'window',
        };
        const ALT_OPEN_LABEL: Record<AltOpenLocation, string> = {
            tab: 'New tab', split: 'New split', window: 'New window',
        };
        const altOpen = new Setting(containerEl)
            .setName('Open results with Cmd/Ctrl in')
            .setDesc('Where a result opens when you hold Cmd/Ctrl while clicking or pressing Enter. A plain click or Enter always opens in the current tab.');
        this.addSegmented(altOpen, Object.keys(ALT_OPEN_VALUE), ALT_OPEN_LABEL[this.s.altOpenLocation], (pick) => {
            void (async () => {
                this.s.altOpenLocation = ALT_OPEN_VALUE[pick];
                await this.save();
                this.rerender(); // repaint the segmented control's active pill
            })();
        });
    }

    // ---- Model & performance -------------------------------------------------------
    private renderModel(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Model & performance').setHeading();

        // Compute backend — PER-DEVICE (localStorage), never synced. Auto / Force CPU /
        // Force WebGPU map to the platform.ts override values auto / wasm / webgpu.
        const computeLabel: Record<BackendChoice, string> = { auto: 'Auto', wasm: 'Force CPU', webgpu: 'Force WebGPU' };
        const labelToChoice: Record<string, BackendChoice> = { Auto: 'auto', 'Force CPU': 'wasm', 'Force WebGPU': 'webgpu' };
        const compute = new Setting(containerEl)
            .setName('Compute')
            .setDesc('How the embedding model runs on this device (this option is not synced to other devices). Auto uses WebGPU when available and falls back to CPU. Changing this setting is not recommended.');
        this.addSegmented(compute, ['Auto', 'Force CPU', 'Force WebGPU'], computeLabel[getBackendOverride()], (pick) => {
            setBackendOverride(labelToChoice[pick]);
            this.rerender(); // forcing WebGPU clears a prior sticky demote; reflect it
        });

        if (isWebgpuDemoted()) {
            new Setting(containerEl)
                .setName('WebGPU disabled after a crash on this device')
                .setDesc('Seeker detected this device was killed by the OS during a WebGPU reindex and fell back to CPU. Reset to let Auto try WebGPU again (e.g. after an OS update).')
                .addButton(b => b.setButtonText('Reset & retry WebGPU').setWarning().onClick(() => {
                    clearWebgpuDemoted();
                    new Notice('Seeker: WebGPU re-enabled on this device. Takes effect on the next model load.', 6000);
                    this.rerender();
                }));
        }

        this.renderModelStatus(containerEl);
    }

    private renderModelStatus(containerEl: HTMLElement): void {
        const ms = this.modelStatus;
        const row = new Setting(containerEl).setName('Embedding model');

        if (this.modelDownloading) {
            const desc = row.descEl;
            desc.createSpan({ cls: 'seeker-spinner' });
            desc.createSpan({ text: ' Downloading the model… (keep Obsidian open)' });
            return;
        }

        if (this.modelDeleting) {
            const desc = row.descEl;
            desc.createSpan({ cls: 'seeker-spinner' });
            desc.createSpan({ text: ' Deleting model…' });
            return;
        }

        const downloaded = ms?.downloaded ?? false;
        const desc = row.descEl;
        const dot = desc.createSpan({ cls: `seeker-dot seeker-dot-${downloaded ? 'good' : 'mid'}` });
        dot.setCssStyles({ marginRight: '6px' });
        if (downloaded) {
            // Model on-disk size (Cache API bytes), relocated here from the index status card.
            // null on platforms that don't expose the usageDetails split (e.g. iOS) — omit it
            // there rather than render a bare dash. Copy is model-agnostic (no "≈100 MB"
            // literal): a user override can be any size.
            const modelMB = this.stats?.modelMB;
            const sizeText = modelMB != null ? `${Math.round(modelMB)} MB` : 'size unknown';
            desc.createSpan({ text: `Downloaded · ${sizeText}` });
        } else {
            desc.createSpan({ text: 'Not downloaded · the first search downloads the model' });
        }
        // Model id + dim + pooling on its own line below the status (a block div, not an
        // inline span) so the long repo name no longer wraps mid-sentence. "(custom)" marks
        // an active user override so it can never be confused with the shipped default.
        if (ms) {
            const custom = ms.isOverride ? ' (custom)' : '';
            desc.createDiv({ cls: 'seeker-faint seeker-model-id', text: `${ms.name} · ${ms.dim}-dim · ${POOLING_LABEL[ms.pooling]} pooling${custom}` });
            // For an override, surface the PINNED commit (short sha) here — outside the
            // disclosure — so the exact bytes every device loads are visible at a glance.
            const rev = this.s.modelOverride?.revision;
            if (ms.isOverride && rev) {
                desc.createDiv({ cls: 'seeker-faint seeker-model-id', text: `${ms.name} @ ${rev.slice(0, 7)}` });
            }
        }
        if (downloaded) {
            // The only downloaded-state action is destructive — it frees the disk bytes and
            // forces a re-download on the next search — so it's a red, two-step Delete
            // (Delete → Cancel / Delete model), never a single click. To re-acquire the
            // model afterward, the resting "Not downloaded" state offers Download now.
            if (this.modelDeleteConfirm) {
                row.addButton(b => b.setButtonText('Cancel').onClick(() => { this.modelDeleteConfirm = false; this.rerender(); }));
                row.addButton(b => b.setButtonText('Delete model').setWarning().onClick(() => this.deleteModel()));
            } else {
                row.addButton(b => b.setButtonText('Delete').setWarning().onClick(() => { this.modelDeleteConfirm = true; this.rerender(); }));
            }
        } else {
            row.addButton(b => b.setButtonText('Download now').setCta().onClick(() => this.downloadModel()));
        }

        // Advanced model settings — a tail disclosure (last thing in the section, visually
        // demoted) holding the user-selectable embedding model. Same seeker-disclosure
        // pattern as Index/Relevance, with its own open-state field.
        const disc = containerEl.createDiv({ cls: 'seeker-disclosure' });
        disc.createSpan({ cls: 'seeker-disclosure-chev', text: this.modelAdvancedOpen ? '▾' : '▸' });
        disc.createSpan({ text: 'Advanced model settings' });
        disc.onclick = () => { this.modelAdvancedOpen = !this.modelAdvancedOpen; this.rerender(); };

        if (this.modelAdvancedOpen) this.renderModelAdvanced(containerEl);
    }

    private downloadModel(): void {
        this.modelDownloading = true;
        this.rerender();
        void this.plugin.prewarmModel().finally(() => {
            this.modelDownloading = false;
            this.modelStatus = null;
            this.rerender();
            void this.loadData(); // refresh downloaded status
        });
    }

    private deleteModel(): void {
        this.modelDeleteConfirm = false;
        this.modelDeleting = true;
        this.rerender();
        void this.plugin.deleteModel().then(() => {
            new Notice('Seeker: embedding model deleted. The next search re-downloads it.', 6000);
        }).catch((e) => {
            new Notice(`Seeker: model delete failed — ${e instanceof Error ? e.message : String(e)}`, 8000);
        }).finally(() => {
            this.modelDeleting = false;
            this.modelStatus = null;
            this.rerender();
            void this.loadData(); // refresh status → now "Not downloaded"
        });
    }

    // ---- Advanced model settings (user-selectable embedding model) ------------------
    // Seed the local candidate from the active model: the persisted override when one is
    // active, else the shipped default's values (with an empty revision so the field shows
    // its "track main, pinned on Validate" placeholder). Lazy so it survives rerenders and
    // reseeds after hide() clears it.
    private ensureCandidate(): ModelCandidate {
        if (this.candidate === null) {
            const o = this.s.modelOverride;
            this.candidate = o
                ? { repo: o.repo, revision: o.revision, pooling: o.pooling, dtype: o.dtype, queryPrefix: o.queryPrefix, docPrefix: o.docPrefix }
                : { repo: ACTIVE_MODEL_SPEC.repo, revision: null, pooling: ACTIVE_MODEL_SPEC.pooling, dtype: ACTIVE_MODEL_SPEC.dtype, queryPrefix: ACTIVE_MODEL_SPEC.queryPrefix, docPrefix: ACTIVE_MODEL_SPEC.docPrefix };
            // The seeded repo counts as committed: no detection until the user changes it.
            this.committedRepo = this.candidate.repo;
        }
        return this.candidate;
    }

    // Drop the draft + everything derived from it (validation, confirms, repo commit
    // state) so the next ensureCandidate() reseeds from the active model.
    private discardCandidate(): void {
        this.candidate = null;
        this.committedRepo = null;
        this.repoError = null;
        this.poolingHint = null;
        this.invalidateValidation();
    }

    // Any field edit invalidates a prior Validate result (Switch must only ever run the
    // exact values that were validated) and drops out of the two-step confirms. Bumping
    // the generation also discards any Validate still in flight for the old values.
    private invalidateValidation(): void {
        this.validationSeq++;
        this.validation = null;
        this.modelSwitchConfirm = false;
        this.modelResetConfirm = false;
    }

    // The confirm sentence for a destructive switch. Model-agnostic; states the target,
    // that the index is deleted (with the note count), and the CONSENT-GATED peer
    // behavior — never "other devices rebuild automatically" (plan "Cross-device
    // behavior": the identity cascade is gated, peers sync a sidecar or show a banner).
    private switchConfirmText(repo: string): string {
        const n = collectIndexableFiles(this.app.vault, this.s).length;
        return `Switch to ${repo}? Seeker deletes the current index (${n.toLocaleString()} note${n === 1 ? '' : 's'}) and re-embeds everything with the new model on this device. Other devices sync the new index from this one (when the shared index is on) or show a reindex banner, and each one downloads the new model on its next search — phones included.`;
    }

    private renderModelAdvanced(containerEl: HTMLElement): void {
        const adv = containerEl.createDiv({ cls: 'seeker-adv' });
        const c = this.ensureCandidate();
        const busy = this.plugin.isIndexing || this.reindexPhase === 'running';

        // Mobile is read-only: a phone never bulk-embeds (it syncs the new index + downloads
        // the model on its next search). Show the active model's fields, disabled, no actions.
        const mobile = isMobilePlatform();

        // Repo — the only field with commit-time behavior: on blur/Enter we validate the
        // slug shape (inline error) and, when good, best-effort detect pooling from the repo.
        const repoRow = new Setting(adv).setName('Repo').setDesc('The Hugging Face model id.');
        repoRow.addText(t => {
            t.setPlaceholder('owner/model-name').setValue(c.repo);
            t.setDisabled(mobile);
            t.onChange(v => { c.repo = v.trim(); this.invalidateValidation(); });
            t.inputEl.addEventListener('blur', () => void this.commitRepo());
            t.inputEl.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') t.inputEl.blur(); });
        });
        if (this.repoError) adv.createDiv({ cls: 'seeker-inline-warn', text: this.repoError });

        // Revision — pinned to an exact commit on Validate so every device loads identical bytes.
        new Setting(adv)
            .setName('Revision')
            .setDesc('Branch, tag or commit. Validate pins it to an exact commit so every device uses identical model files.')
            .addText(t => {
                t.setPlaceholder('main (pinned on Validate)').setValue(c.revision ?? '');
                t.setDisabled(mobile);
                t.onChange(v => { c.revision = v.trim() === '' ? null : v.trim(); this.invalidateValidation(); });
            });

        // Pooling — dropdown + the repo-detection hint set by commitRepo().
        const poolRow = new Setting(adv).setName('Pooling').setDesc('How token vectors collapse into one sentence vector. Must match how the model was trained.');
        poolRow.addDropdown(dd => {
            dd.addOption('cls', POOLING_LABEL.cls).addOption('mean', POOLING_LABEL.mean).setValue(c.pooling);
            dd.selectEl.disabled = mobile;
            dd.onChange(v => { c.pooling = v as Pooling; this.poolingHint = null; this.invalidateValidation(); this.rerender(); });
        });
        if (this.poolingHint) poolRow.descEl.createDiv({ cls: 'seeker-hint', text: this.poolingHint });

        // Precision (dtype).
        new Setting(adv).setName('Precision').setDesc('Smaller is faster and lighter; larger is more accurate. The repo must export ONNX weights for the choice.')
            .addDropdown(dd => {
                for (const o of PRECISION_OPTIONS) dd.addOption(o.value, o.label);
                dd.setValue(c.dtype);
                dd.selectEl.disabled = mobile;
                dd.onChange(v => { c.dtype = v as Dtype; this.invalidateValidation(); this.rerender(); });
            });

        // Query / Document prefixes — some models (e5 family) require them.
        new Setting(adv).setName('Query prefix').setDesc('Prepended to your search text before embedding. Some models need this — e.g. e5 uses "query: " (include the trailing space). Leave empty if unsure.')
            .addText(t => {
                t.setPlaceholder('query: ').setValue(c.queryPrefix);
                t.setDisabled(mobile);
                t.onChange(v => { c.queryPrefix = v; this.invalidateValidation(); });
            });
        new Setting(adv).setName('Document prefix').setDesc('Prepended to every indexed note before embedding. Some models need this — e.g. e5 uses "passage: " (include the trailing space). Leave empty if unsure.')
            .addText(t => {
                t.setPlaceholder('passage: ').setValue(c.docPrefix);
                t.setDisabled(mobile);
                t.onChange(v => { c.docPrefix = v; this.invalidateValidation(); });
            });

        if (mobile) {
            adv.createDiv({ cls: 'seeker-hint', text: 'Change the model from a desktop device. This device then syncs the new index from it and downloads the new model on its next search.' });
            return;
        }

        this.renderModelActions(adv, c, busy);
    }

    // Validate / Switch buttons, the Validate result line, and the "Reset to default
    // model" affordance. Desktop only (renderModelAdvanced returns early on mobile).
    private renderModelActions(adv: HTMLElement, c: ModelCandidate, busy: boolean): void {
        // Two-step switch confirm — same row pattern as "Delete & reindex".
        if (this.modelSwitchConfirm && this.validation?.ok) {
            const v = this.validation;
            new Setting(adv)
                .setName('Switch model & reindex')
                .setDesc(this.switchConfirmText(c.repo))
                .addButton(b => b.setButtonText('Cancel').onClick(() => { this.modelSwitchConfirm = false; this.rerender(); }))
                .addButton(b => b.setButtonText('Delete index & switch').setWarning()
                    .onClick(() => this.runModelSwitch({ ...c, dim: v.dim, revision: v.revision })));
            return;
        }

        // Validate + Switch buttons.
        const actions = new Setting(adv).setName('Validate the model').setDesc('Download and load the model to confirm it works, then switch to it.');
        if (this.validating) {
            actions.descEl.empty();
            actions.descEl.createSpan({ cls: 'seeker-spinner' });
            actions.descEl.createSpan({ text: ' Downloading and loading the model…' });
        }
        actions.addButton(b => b.setButtonText('Validate').setCta()
            .setDisabled(this.validating || busy)
            .onClick(() => this.runValidate()));
        actions.addButton(b => b.setButtonText('Switch model & reindex').setWarning()
            .setDisabled(!(this.validation?.ok) || this.validating || busy)
            .onClick(() => { this.modelSwitchConfirm = true; this.rerender(); }));

        if (busy) adv.createDiv({ cls: 'seeker-hint', text: 'Wait for indexing to finish.' });

        // Validate result line: dim · precision · device · pinned sha (good) or the
        // plain-language error (bad). Input is preserved either way.
        if (!this.validating && this.validation) {
            const line = adv.createDiv({ cls: 'seeker-hint' });
            if (this.validation.ok) {
                line.createSpan({ cls: 'seeker-dot seeker-dot-good' }).setCssStyles({ marginRight: '6px' });
                line.createSpan({ text: `${this.validation.dim}-dim · ${this.validation.dtype} · ${DEVICE_LABEL[this.validation.device]} · pinned to ${this.validation.revision.slice(0, 7)}` });
            } else {
                line.createSpan({ cls: 'seeker-dot seeker-dot-bad' }).setCssStyles({ marginRight: '6px' });
                line.createSpan({ text: this.validation.error });
            }
        }

        // Reset to default model — only when an override is active. Same destructive
        // two-step confirm, targeting the shipped model.
        if (this.modelStatus?.isOverride) {
            if (this.modelResetConfirm) {
                new Setting(adv)
                    .setName('Reset to default model')
                    .setDesc(this.switchConfirmText(ACTIVE_MODEL_SPEC.repo))
                    .addButton(b => b.setButtonText('Cancel').onClick(() => { this.modelResetConfirm = false; this.rerender(); }))
                    .addButton(b => b.setButtonText('Delete index & switch').setWarning().onClick(() => this.runModelSwitch(null)));
            } else {
                new Setting(adv)
                    .setName('Reset to default model')
                    .setDesc('Go back to the model Seeker ships with. Deletes the index and reindexes on this device.')
                    .setDisabled(busy)
                    .addButton(b => b.setButtonText('Reset model…').setWarning()
                        .setDisabled(busy)
                        .onClick(() => { this.modelResetConfirm = true; this.rerender(); }));
            }
        }
    }

    // Blur/Enter on the Repo field: validate the slug shape (inline error), and on a good
    // slug best-effort detect pooling from the repo to prefill the dropdown + hint.
    private async commitRepo(): Promise<void> {
        const c = this.ensureCandidate();
        const repo = c.repo;   // already trimmed by the field's onChange
        // Unchanged since the last commit (blur without an edit): nothing to do. The
        // keystroke onChange already invalidated any validation for a real edit.
        if (repo === this.committedRepo) return;
        this.committedRepo = repo;
        const hadError = this.repoError !== null;
        if (repo === '') {
            this.repoError = null; this.poolingHint = null;
            if (hadError) this.rerender();
            return;
        }
        if (!isValidHfSlug(repo)) {
            this.repoError = 'Not a valid Hugging Face model id — use owner/name (e.g. sentence-transformers/all-MiniLM-L6-v2).';
            this.poolingHint = null;
            this.rerender();
            return;
        }
        // Valid slug: clear any stale error and detect pooling. We deliberately do NOT
        // rerender synchronously here — a blur fires on a button's mousedown, and rebuilding
        // the DOM before mouseup would eat a click on Validate/Switch. The pooling detection
        // rerenders once it resolves (well after any click), and the error banner only shows
        // on the invalid path above, so nothing user-visible is withheld on the valid path.
        this.repoError = null;
        const detected = await this.plugin.detectPooling(repo, c.revision);
        // The candidate may have moved on while the fetch was in flight (user kept typing);
        // only apply the detection if the repo it was for is still the current one.
        if (this.candidate?.repo !== repo) return;
        if (detected) {
            // Applying a different pooling is a field edit like any other: it must
            // invalidate a Validate that ran (or is still running) with the old value.
            if (this.candidate.pooling !== detected) {
                this.candidate.pooling = detected;
                this.invalidateValidation();
            }
            this.poolingHint = 'Detected from the repo.';
        } else {
            this.poolingHint = 'Not declared by the repo — pick manually.';
        }
        this.rerender();
    }

    private runValidate(): void {
        this.invalidateValidation();
        const seq = this.validationSeq;
        this.validating = true;
        this.rerender();
        // Only accept the result if nothing invalidated it while it ran (an edit, a
        // pooling detection landing, hide()); a discarded result just leaves the user
        // with no result line, and Switch stays disabled until they Validate again.
        void this.plugin.validateModelCandidate({ ...this.ensureCandidate() })
            .then(result => { if (seq === this.validationSeq) this.validation = result; })
            .catch(e => { if (seq === this.validationSeq) this.validation = { ok: false, error: e instanceof Error ? e.message : String(e) }; })
            .finally(() => { this.validating = false; this.rerender(); });
    }

    // Drive a model switch (or reset, next === null) through the SAME progress UI as a
    // full reindex (reindexPhase 'running'). The plugin Notices on refusal and on a
    // failed reindex; here we only settle the tab state afterwards.
    private runModelSwitch(next: ModelOverride | null): void {
        this.reindexTotal = collectIndexableFiles(this.app.vault, this.s).length;
        this.reindexDone = 0;
        this.reindexPhase = 'running';
        this.modelSwitchConfirm = false;
        this.modelResetConfirm = false;
        this.rerender();

        // switchModel persists the override BEFORE its reindex, so "did the active model
        // change?" is answered by the settings object, not by the returned boolean: a
        // reindex that failed mid-way (false) still switched the model, and the status
        // card must say so; a refusal (also false) changed nothing, so the draft and
        // its validation survive for a retry.
        const before = this.s.modelOverride;
        void this.plugin.switchModel(next, (msg) => this.onReindexProgress(msg))
            .catch(() => false)
            .then(() => {
                this.reindexPhase = 'idle';
                if (this.s.modelOverride !== before) this.discardCandidate();
                this.stats = null;
                this.modelStatus = null;
                this.rerender();
                void this.loadData();
            });
    }

    // ---- Diagnostics + Reset --------------------------------------------------------
    private renderReset(containerEl: HTMLElement): void {
        // Diagnostics first, under its own heading, and rendered BEFORE the
        // reset-confirm early-return below so the report button is always visible
        // (it replaces the removed "Generate logging report" command). openLoggingReport
        // renders the per-device NDJSON logs into seeker-report.md and opens it.
        new Setting(containerEl).setName('Diagnostics').setHeading();
        new Setting(containerEl)
            .setName('Logging report')
            .setDesc('Write a diagnostic report (seeker-report.md) of indexing, searches, model loads, and any errors — generate and share it when reporting an issue. Never includes note contents.')
            .addButton(b => b.setButtonText('Generate logging report').onClick(() => void this.plugin.openLoggingReport()));

        // Placed directly under the button that produces the file it governs, so
        // the choice is in front of the user at the moment it applies.
        new Setting(containerEl)
            .setName('Redact report')
            .setDesc('Replace note paths, titles, and query text in the report with anonymous tokens. The same note keeps the same token, so timings and errors still make sense. Turn this off only when reporting a search-relevance problem, where the actual query and results are the evidence.')
            .addToggle(t => t.setValue(this.s.redactReport).onChange(async v => {
                this.s.redactReport = v;
                await this.save();
            }));

        new Setting(containerEl).setName('Reset').setHeading();
        if (this.resetConfirm) {
            new Setting(containerEl)
                .setName('Reset to defaults')
                .setDesc('Restores the default configuration for all Seeker settings. Your index will not be rebuilt. The embedding model is not changed — use "Reset to default model" for that.')
                .addButton(b => b.setButtonText('Cancel').onClick(() => { this.resetConfirm = false; this.rerender(); }))
                .addButton(b => b.setButtonText('Reset settings').setWarning().onClick(async () => {
                    // Restore every persisted (synced) setting. Compute is per-device
                    // localStorage, not part of data.json, so it is deliberately untouched.
                    Object.assign(this.s, DEFAULT_SETTINGS);
                    await this.save();
                    this.resetConfirm = false;
                    new Notice('Seeker: settings restored to defaults. Your index was not rebuilt.', 6000);
                    this.rerender();
                }));
            return;
        }
        new Setting(containerEl)
            .setName('Reset to defaults')
            .setDesc('Restore all Seeker settings to their original values. Your index will not be rebuilt. The embedding model is not changed — use "Reset to default model" for that.')
            .addButton(b => b.setButtonText('Reset…').onClick(() => { this.resetConfirm = true; this.rerender(); }));
    }
    private resetConfirm = false;

    // ---- About ---------------------------------------------------------------------
    private renderAbout(containerEl: HTMLElement): void {
        const about = containerEl.createDiv({ cls: 'seeker-about' });
        const left = about.createDiv({ cls: 'seeker-about-left' });
        left.createSpan({ cls: 'seeker-about-name', text: 'Seeker' });
        left.createSpan({ cls: 'seeker-about-ver', text: `v${this.plugin.manifest.version}` });
        left.createSpan({ cls: 'seeker-about-by', text: 'by nickolaykondratyev' });

        const links = about.createDiv({ cls: 'seeker-about-links' });
        // Lucide-named icon button (GitHub, Docs).
        const link = (href: string, icon: string, label: string) => {
            const a = links.createEl('a', { cls: 'seeker-about-ic', href, attr: { 'aria-label': label, title: label } });
            setIcon(a, icon);
        };
        link(DOCS_URL, 'book-open', 'Seek Documentation');
        link(GITHUB_URL, 'github', 'Repository on GitHub');
    }

    // ---- shared: segmented (pill) control ------------------------------------------
    private addSegmented(setting: Setting, opts: string[], selected: string, onPick: (o: string) => void): void {
        const seg = setting.controlEl.createDiv({ cls: 'seeker-seg' });
        for (const o of opts) {
            const b = seg.createEl('button', { cls: 'seeker-seg-opt', text: o });
            if (o === selected) b.addClass('is-active');
            b.onclick = () => onPick(o);
        }
    }
}
