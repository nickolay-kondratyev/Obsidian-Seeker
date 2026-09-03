// Synthetic search documents for Obsidian `.canvas` files.
//
// A canvas is JSON (`node_modules/obsidian/canvas.d.ts` CanvasData): text cards,
// file references, external links and groups, plus edges. Only text that lives
// IN the canvas is indexed (docs/canvas-search-plan.md §2): file nodes are NOT
// expanded — the referenced note is indexed under its own path already, and a
// canvas chunk must stay a pure function of the canvas bytes so its ids are
// re-derivable from the file alone (sidecar hydrate invariant).
//
// Model (plan §3a, mirrors base-extractor.ts + chunkBase): `extractCanvasDocs`
// returns ONE map document plus one document per LONG text card; the chunker
// (`chunkCanvas`) pushes each through chunkContent so heading split, folding and
// the token budget apply unchanged.
//   - Map document: a SYNTHETIC MARKDOWN doc. Each distinct group chain is a
//     heading (level = depth, capped at 6 — HEADING_RE stops there), so the
//     chunker's heading_path carries the chain. Under it, one `- ` line per item
//     living in that chain: short cards verbatim, file nodes as
//     `[[basename#subpath]]` (dense-clean flattens it, link_terms reclaims the
//     target — identical treatment to a wikilink in a note), link URLs, and edge
//     labels under their fromNode's chain. Ungrouped items form the preamble.
//     Short cards fold into the map instead of becoming one tiny vector each —
//     the universal-near-neighbour hazard `lexicalOnly` in types.ts documents.
//   - Long-card documents: the card's raw markdown, tagged with its node id and
//     group chain (→ chunkContent headingPrefix). No invented node label (Q6).
//
// Group membership is GEOMETRIC — the file has no parent links. A node belongs
// to every group whose rect contains its rect (px tolerance so flush-snapped
// rects count); the chain is those groups' labels sorted by area, largest
// (outermost) first. Unlabelled groups count for containment but add no name.
//
// Injection safety (plan §6 R2): every map item is ONE line (`- ` prefix,
// internal newlines collapsed) and items are blank-line separated, so a card
// starting with `# `, ``` or `---` can never open a heading/fence/frontmatter
// in the synthetic doc, and each item is its own paragraph atom for the token
// budget's re-split. Item order within a section is by TEXT, not node order:
// Obsidian rewrites the nodes array on z-order changes (select/drag), and a
// content-independent order keeps the map chunk ids stable through that.
//
// Pure and Obsidian-free: JSON only, so it runs in vitest and the live re-chunk
// path unchanged. Never throws — the worst case is a name-only map document.

import type { CanvasDoc } from './types';
import { cleanDenseBody } from './dense-clean';

// Flush-snapped rects (card edge exactly on the group edge, or off by a
// sub-pixel drag) still count as inside.
export const GROUP_CONTAINMENT_TOLERANCE_PX = 1;

// HEADING_RE (atoms.ts) recognises `#`..`######`; deeper chains truncate in the
// map's heading_path (documented, accepted — 7-deep nesting is theoretical).
const MAX_HEADING_LEVEL = 6;

interface Rect { x: number; y: number; width: number; height: number }

interface GroupNode {
    rect: Rect;
    label: string | null;   // null = unlabelled (transparent)
    order: number;          // file position, area tie-break
}

// A map item (one rendered line) filed under a group chain.
interface MapItem { chain: string[]; line: string }

function basename(path: string): string {
    return path.split('/').pop()!.replace(/\.canvas$/, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

// Geometry guard (plan §6 R7): a node missing numeric x/y/width/height is
// treated as UNGROUPED, never as a throw.
function rectOf(node: Record<string, unknown>): Rect | null {
    const { x, y, width, height } = node;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
    return { x, y, width, height };
}

// One line: internal newlines and runs of whitespace collapse to a single space.
function oneLine(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

function contains(outer: Rect, inner: Rect, tol: number): boolean {
    return inner.x >= outer.x - tol
        && inner.y >= outer.y - tol
        && inner.x + inner.width <= outer.x + outer.width + tol
        && inner.y + inner.height <= outer.y + outer.height + tol;
}

function area(r: Rect): number {
    return r.width * r.height;
}

// The labelled chain of every group containing `rect`, outermost first.
// `self` excludes a group from its own chain (a rect trivially contains itself).
function chainFor(groups: GroupNode[], rect: Rect, self: GroupNode | null): string[] {
    return groups
        .filter(g => g !== self && contains(g.rect, rect, GROUP_CONTAINMENT_TOLERANCE_PX))
        .sort((a, b) => area(b.rect) - area(a.rect) || a.order - b.order)
        .map(g => g.label)
        .filter((l): l is string => l !== null);
}

// `[[basename#subpath]]` — the wikilink form a note would use for the same
// target. `.md` is dropped (Obsidian omits it in links); other extensions
// (`img.png`, `x.canvas`) are kept because Obsidian requires them.
function fileNodeLine(file: string, subpath: unknown): string {
    const name = file.split('/').pop()!.replace(/\.md$/i, '');
    const sub = typeof subpath === 'string' ? subpath.trim() : '';
    return `[[${name}${sub}]]`;
}

// Chain trie for the map document: groups with items under nested headings
// are emitted depth-first so `# A` precedes `## B` (heading_path ["A","B"]).
class ChainNode {
    readonly children = new Map<string, ChainNode>();
    readonly items: string[] = [];

    child(label: string): ChainNode {
        let c = this.children.get(label);
        if (!c) {
            c = new ChainNode();
            this.children.set(label, c);
        }
        return c;
    }

    add(chain: string[], line: string): void {
        let node: ChainNode = this;
        for (const label of chain) node = node.child(label);
        node.items.push(line);
    }

    // Render to markdown. Items are blank-line separated `- ` lines (own
    // paragraph atoms, injection-safe); children are sorted by label so the
    // output is independent of node order in the file.
    render(depth: number, out: string[]): void {
        for (const line of [...this.items].sort()) out.push(`- ${line}`, '');
        for (const label of [...this.children.keys()].sort()) {
            const level = Math.min(depth + 1, MAX_HEADING_LEVEL);
            out.push(`${'#'.repeat(level)} ${label}`, '');
            this.children.get(label)!.render(depth + 1, out);
        }
    }
}

function parseCanvas(raw: string): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = null;
    }
    const data = isRecord(parsed) ? parsed : {};
    const records = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(isRecord) : [];
    return { nodes: records(data.nodes), edges: records(data.edges) };
}

// Extract the search documents of a `.canvas` file: the map document (nodeId
// null) first, then one document per LONG text card in file order. A card is
// long when its DENSE-CLEANED length reaches `minChunkChars` — the same gate
// the chunker applies to a note section (plan §6 R3) — so a card that is 200
// raw chars of embeds/URLs folds into the map (as its raw line, so link_terms
// reclaims the targets) instead of becoming a near-empty standalone vector.
// Malformed / empty / node-less input degrades to a map document holding the
// canvas name, so the canvas stays findable by name.
export function extractCanvasDocs(raw: string, path: string, minChunkChars: number): CanvasDoc[] {
    const { nodes, edges } = parseCanvas(raw);

    const groups: GroupNode[] = [];
    const groupByNode = new Map<Record<string, unknown>, GroupNode>();
    nodes.forEach((n, order) => {
        if (n.type !== 'group') return;
        const rect = rectOf(n);
        if (!rect) return;   // a group without geometry can contain nothing
        const label = typeof n.label === 'string' ? oneLine(n.label) : '';
        const g: GroupNode = { rect, label: label || null, order };
        groups.push(g);
        groupByNode.set(n, g);
    });

    // A group's own chain includes itself (edge-from-group attribution, R7);
    // a node without geometry is ungrouped (empty chain).
    const chainOfNode = (n: Record<string, unknown>): string[] => {
        const rect = rectOf(n);
        if (!rect) return [];
        const self = groupByNode.get(n) ?? null;
        const own = self?.label ? [self.label] : [];
        return [...chainFor(groups, rect, self), ...own];
    };
    const chainById = new Map<string, string[]>();

    const items: MapItem[] = [];
    const longCards: CanvasDoc[] = [];

    for (const n of nodes) {
        const chain = chainOfNode(n);
        if (typeof n.id === 'string') chainById.set(n.id, chain);
        switch (n.type) {
            case 'text': {
                if (typeof n.text !== 'string') break;
                const isLong = cleanDenseBody(n.text).length >= minChunkChars;
                if (isLong && typeof n.id === 'string') {
                    longCards.push({ nodeId: n.id, groupChain: chain, text: n.text });
                } else {
                    const line = oneLine(n.text);
                    if (line) items.push({ chain, line });
                }
                break;
            }
            case 'file':
                if (typeof n.file === 'string' && n.file.trim()) items.push({ chain, line: fileNodeLine(n.file.trim(), n.subpath) });
                break;
            case 'link':
                if (typeof n.url === 'string' && n.url.trim()) items.push({ chain, line: oneLine(n.url) });
                break;
            default:
                break;   // groups contribute headings only; unknown types are skipped
        }
    }

    // Edge labels live under their fromNode's chain; an unknown or malformed
    // fromNode falls to the preamble rather than being dropped.
    for (const e of edges) {
        if (typeof e.label !== 'string') continue;
        const line = oneLine(e.label);
        if (!line) continue;
        const chain = typeof e.fromNode === 'string' ? chainById.get(e.fromNode) ?? [] : [];
        items.push({ chain, line });
    }

    const root = new ChainNode();
    for (const it of items) root.add(it.chain, it.line);
    const lines: string[] = [];
    root.render(0, lines);
    const map = lines.join('\n').trim();

    return [
        { nodeId: null, groupChain: [], text: map || basename(path) },
        ...longCards,
    ];
}
