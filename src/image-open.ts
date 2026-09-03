// Opening an image search result: guaranteed open, best-effort landing.
// Plan of record: docs/research/image-ocr.md §2a + §9 Q2 + §12 D5.
//
// An image document (its OCR text is what matched) has no editable text of its
// own, so — like the `.base` / `.canvas` branches — we skip the markdown
// highlight/scroll path entirely. Where a hit LANDS is resolved READ-SIDE at
// open time from `metadataCache.resolvedLinks` (the index stores nothing about
// referrers, so a link edit never touches the index):
//   · exactly ONE note references the image → open that NOTE, best-effort
//     scrolled to the line holding the `![[…]]` / `![](…)` embed;
//   · zero or several referrers → open the IMAGE file itself.
// The referrer set + the embed line are computed by the modal (they need async
// vault reads) and handed in as an `ImageOpenTarget`; this module owns only the
// leaf open + the best-effort scroll, so it is unit-testable with a fake leaf —
// the same split as `canvas-open.ts`.
//
// "Guaranteed open, best-effort position": SOMETHING always opens (never a throw
// past the click), and the scroll to the embed line can never leave the user on
// the wrong place — a missing editor or a thrown scroll leaves the note open
// where Obsidian put it, with at most one diagnostics line.

import type { TFile, WorkspaceLeaf } from 'obsidian';

// metadataCache.resolvedLinks shape: source note path → { target path → count }.
export type ResolvedLinks = Record<string, Record<string, number>>;

// What the modal resolved the click into. `image` = open the image file passed
// to `open`; `note` = open this note, scrolling to `line` (0-based) when it is
// not null (null = the referrer was found in resolvedLinks but its embed line
// couldn't be located in the raw text → open the note, no scroll).
export type ImageOpenTarget =
    | { kind: 'image' }
    | { kind: 'note'; note: TFile; line: number | null };

// Where the user actually landed. Diagnostic + test surface; the modal treats
// every outcome the same (something is open either way).
export type ImageOpenOutcome =
    | 'opened-image'      // 0 or ≥2 referrers → the image file itself
    | 'opened-note'       // exactly 1 referrer → the note, scrolled to the embed line
    | 'opened-note-top'   // 1 referrer, but no embed line / no editor → note open, no scroll
    | 'scroll-failed';    // the editor threw applying the scroll; the note stays open

// The slice of a MarkdownView's editor we touch to scroll to the embed line.
// Feature-detected (not `instanceof MarkdownView`) so the module stays testable
// with a fake leaf and so a not-yet-ready / preview view is a clean no-op.
interface EditorLike {
    setCursor(pos: { line: number; ch: number }): void;
    scrollIntoView(range: { from: { line: number; ch: number }; to: { line: number; ch: number } }, center: boolean): void;
}

export interface ImageOpenDeps {
    // ONE diagnostics line per failed scroll (logger.appendError in production).
    reportFailure: (context: string, e: unknown) => void;
}

export class ImageResultOpener {
    constructor(private readonly deps: ImageOpenDeps) {}

    // Opens the resolved target in `leaf` (the guaranteed step) and, for a note
    // target with a known embed line, best-effort scrolls to it. `active` follows
    // the modal's open semantics (background alt-open keeps the modal focused).
    async open(
        leaf: WorkspaceLeaf,
        image: TFile,
        target: ImageOpenTarget,
        active: boolean,
    ): Promise<ImageOpenOutcome> {
        if (target.kind === 'image') {
            await leaf.openFile(image, { active });
            return 'opened-image';
        }
        await leaf.openFile(target.note, { active });
        if (target.line == null) return 'opened-note-top';
        return this.scrollToLine(leaf, target.line);
    }

    private scrollToLine(leaf: WorkspaceLeaf, line: number): ImageOpenOutcome {
        const editor = detectEditor(leaf.view);
        if (!editor) return 'opened-note-top';   // preview mode / view not ready
        try {
            editor.setCursor({ line, ch: 0 });
            editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
            return 'opened-note';
        } catch (e) {
            this.deps.reportFailure('image-embed-scroll', e);
            return 'scroll-failed';
        }
    }
}

// Feature detection is the ONLY place that assumes the view's shape.
function detectEditor(view: unknown): EditorLike | null {
    const editor = (view as { editor?: unknown } | null | undefined)?.editor as Partial<EditorLike> | undefined;
    if (!editor || typeof editor !== 'object') return null;
    if (typeof editor.setCursor !== 'function') return null;
    if (typeof editor.scrollIntoView !== 'function') return null;
    return editor as EditorLike;
}

// ── Pure helpers (unit-tested without Obsidian) ──────────────────────────────

// Every note that references the image at `imagePath`, by source path.
// resolvedLinks keys are RESOLVED (full-vault) paths, so an exact key test is
// the right match here — the fuzzy basename logic below is only for locating the
// embed WITHIN a note's raw text.
export function referrersOf(imagePath: string, resolvedLinks: ResolvedLinks): string[] {
    const out: string[] = [];
    for (const source of Object.keys(resolvedLinks)) {
        if (Object.prototype.hasOwnProperty.call(resolvedLinks[source], imagePath)) out.push(source);
    }
    return out;
}

// 0-based line of the FIRST embed of `imagePath` in `noteText`, or null when no
// line holds one. Matches wiki (`![[…]]`) and markdown (`![](…)`) embeds, with or
// without an alias/size suffix and with percent-encoded spaces in markdown links.
// Best-effort by design: the referrer is already known (referrersOf), so a lenient
// basename match is enough to find the line and never a wrong-file risk here.
export function embedLineFor(noteText: string, imagePath: string): number | null {
    const lines = noteText.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lineEmbedsImage(lines[i], imagePath)) return i;
    }
    return null;
}

// `![[target]]` / `![[target|alias]]` / `![[target|size]]`.
const WIKI_EMBED = /!\[\[([^\]]+)\]\]/g;
// `![alt](target)` — target may be `<…>`-wrapped and/or carry a "title".
const MD_EMBED = /!\[[^\]]*\]\(([^)]+)\)/g;

function lineEmbedsImage(line: string, imagePath: string): boolean {
    WIKI_EMBED.lastIndex = 0;
    for (let m = WIKI_EMBED.exec(line); m; m = WIKI_EMBED.exec(line)) {
        const target = m[1].split('|')[0];   // drop the alias/size suffix
        if (embedTargetMatches(target, imagePath)) return true;
    }
    MD_EMBED.lastIndex = 0;
    for (let m = MD_EMBED.exec(line); m; m = MD_EMBED.exec(line)) {
        let target = m[1].trim();
        // `<path with spaces>` — angle brackets wrap a path that may hold spaces,
        // optionally followed by a "title"; otherwise a space starts the title.
        if (target.startsWith('<')) {
            const close = target.indexOf('>');
            target = close === -1 ? target.slice(1) : target.slice(1, close);
        } else {
            target = target.split(/\s+/)[0];
        }
        if (embedTargetMatches(target, imagePath)) return true;
    }
    return false;
}

// Does an embed target resolve to `imagePath`? Full-path equality first, then a
// case-insensitive basename match so a short link (`![[shot.png]]` for
// `assets/shot.png`) or a relative one (`../img/shot.png`) still locates the line.
function embedTargetMatches(rawTarget: string, imagePath: string): boolean {
    let t = rawTarget.split('#')[0].trim();   // drop any subpath/anchor (rare for images)
    try { t = decodeURIComponent(t); } catch { /* malformed %-escape: match the raw text */ }
    if (t === imagePath) return true;
    return basename(t).toLowerCase() === basename(imagePath).toLowerCase();
}

function basename(path: string): string {
    return path.split('/').pop() ?? path;
}
