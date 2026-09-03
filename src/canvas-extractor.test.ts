import { describe, it, expect } from 'vitest';
import { extractCanvasDocs, GROUP_CONTAINMENT_TOLERANCE_PX } from './canvas-extractor';
import type { CanvasDoc } from './types';

// Threshold the chunker passes in production (MarkdownChunker default).
const MIN = 50;
const PATH = 'Plans/Roadmap.canvas';

type Rect = { x: number; y: number; width: number; height: number };
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const group = (id: string, r: Rect, label?: string) => ({ id, type: 'group', ...r, ...(label !== undefined && { label }) });
const text = (id: string, r: Rect, t: string) => ({ id, type: 'text', ...r, text: t });
const file = (id: string, r: Rect, f: string, subpath?: string) => ({ id, type: 'file', ...r, file: f, ...(subpath && { subpath }) });
const link = (id: string, r: Rect, url: string) => ({ id, type: 'link', ...r, url });
const edge = (id: string, fromNode: string, toNode: string, label?: string) => ({ id, fromNode, toNode, ...(label !== undefined && { label }) });
const canvas = (nodes: unknown[], edges: unknown = []) => JSON.stringify({ nodes, edges });

const LONG = 'A long card: ' + 'lorem ipsum dolor sit amet '.repeat(8);   // well over MIN after cleaning

const mapOf = (docs: CanvasDoc[]): CanvasDoc => docs.find(d => d.nodeId === null)!;
const cardsOf = (docs: CanvasDoc[]): CanvasDoc[] => docs.filter(d => d.nodeId !== null);

// Parse the synthetic map markdown into { chain → items } so tests assert
// structure, not byte layout. Chain key = heading texts joined by ' > ' ('' =
// preamble). Mirrors the chunker's heading-stack rule (a heading pops stack
// entries of >= level) so a truncated 7-deep chain reads the way heading_path will.
function sections(map: string): Record<string, string[]> {
    const out: Record<string, string[]> = { '': [] };
    const stack: Array<{ level: number; text: string }> = [];
    let key = '';
    for (const line of map.split('\n')) {
        const h = /^(#{1,6}) (.+)$/.exec(line);
        if (h) {
            const level = h[1].length;
            while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
            stack.push({ level, text: h[2] });
            key = stack.map(s => s.text).join(' > ');
            out[key] ??= [];
        } else if (line.length > 0) {
            out[key].push(line);
        }
    }
    return out;
}

describe('extractCanvasDocs — fixture with all four node types + edges', () => {
    const RAW = canvas([
        group('gRoad', rect(0, 0, 1000, 1000), 'Roadmap'),
        group('gQ3', rect(100, 100, 400, 400), 'Q3 Goals'),
        group('gAnon', rect(150, 150, 300, 300)),                       // unlabelled, inside Q3 Goals
        text('tShip', rect(200, 200, 100, 50), 'Ship search'),           // inside all three groups
        text('tLong', rect(600, 600, 300, 300), LONG),                   // inside Roadmap only
        file('fPlan', rect(50, 50, 40, 40), 'Notes/Plan.md', '#Timeline'),
        link('lDocs', rect(2000, 2000, 100, 100), 'https://example.com/docs'),
        text('tEdge', rect(900, 900, 300, 100), 'Partly outside card'), // crosses Roadmap's edge
    ], [
        edge('e1', 'tShip', 'tLong', 'depends on'),
        edge('e2', 'gRoad', 'lDocs', 'leads to'),
        edge('e3', 'nope', 'tLong', 'orphan'),
        edge('e4', 'tShip', 'fPlan'),
    ]);
    const docs = extractCanvasDocs(RAW, PATH, MIN);

    it('emits the map document first (nodeId null, empty groupChain)', () => {
        expect(docs[0]).toMatchObject({ nodeId: null, groupChain: [] });
    });

    it('emits exactly one long-card doc, verbatim text, with its outer→inner chain', () => {
        expect(cardsOf(docs)).toEqual([{ nodeId: 'tLong', groupChain: ['Roadmap'], text: LONG }]);
    });

    it('nests group headings by chain depth and skips the unlabelled group', () => {
        const map = mapOf(docs).text;
        expect(map).toContain('\n# Roadmap\n');
        expect(map).toContain('\n## Q3 Goals\n');
        expect(map).not.toMatch(/^#{1,6} *$/m);
    });

    it('files the short card under its full chain, transparent to the unlabelled group', () => {
        expect(sections(mapOf(docs).text)['Roadmap > Q3 Goals']).toContain('- Ship search');
    });

    it('renders a file node as [[basename#subpath]] under its chain', () => {
        expect(sections(mapOf(docs).text)['Roadmap']).toContain('- [[Plan#Timeline]]');
    });

    it('puts a link node URL and a partially-outside card in the preamble', () => {
        const pre = sections(mapOf(docs).text)[''];
        expect(pre).toContain('- https://example.com/docs');
        expect(pre).toContain('- Partly outside card');
    });

    it('attributes an edge label to its fromNode chain', () => {
        expect(sections(mapOf(docs).text)['Roadmap > Q3 Goals']).toContain('- depends on');
    });

    it('an edge from a GROUP lands in that group\'s own chain', () => {
        expect(sections(mapOf(docs).text)['Roadmap']).toContain('- leads to');
    });

    it('an edge from an unknown node lands in the preamble; an unlabelled edge adds nothing', () => {
        const s = sections(mapOf(docs).text);
        expect(s['']).toContain('- orphan');
        const all = Object.values(s).flat();
        expect(all.filter(l => l.startsWith('- ')).length).toBe(7);   // 3 preamble + 2 Roadmap + 2 Q3
    });

    it('every map item is one `- ` line and items are blank-line separated (own paragraph atoms)', () => {
        const lines = mapOf(docs).text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('- ')) continue;
            if (i + 1 < lines.length) expect(lines[i + 1]).toBe('');
        }
    });
});

describe('extractCanvasDocs — degraded inputs yield a name-only map doc', () => {
    const NAME_ONLY: CanvasDoc[] = [{ nodeId: null, groupChain: [], text: 'Roadmap' }];
    it.each([
        ['malformed JSON', '{ nodes: ['],
        ['empty string', ''],
        ['missing nodes', '{}'],
        ['nodes not an array', '{"nodes": 5, "edges": []}'],
        ['top-level array', '[]'],
        ['top-level null', 'null'],
        ['empty canvas', canvas([])],
    ])('%s', (_label, raw) => {
        expect(extractCanvasDocs(raw, PATH, MIN)).toEqual(NAME_ONLY);
    });

    it('a canvas of only long cards still emits the name-only map doc first', () => {
        const docs = extractCanvasDocs(canvas([text('t', rect(0, 0, 10, 10), LONG)]), PATH, MIN);
        expect(docs.map(d => d.nodeId)).toEqual([null, 't']);
        expect(docs[0].text).toBe('Roadmap');
    });
});

describe('extractCanvasDocs — group geometry', () => {
    it('3-deep nesting yields the full outer→inner chain and heading levels 1..3', () => {
        const docs = extractCanvasDocs(canvas([
            group('a', rect(0, 0, 900, 900), 'A'),
            group('b', rect(100, 100, 700, 700), 'B'),
            group('c', rect(200, 200, 500, 500), 'C'),
            text('long', rect(300, 300, 100, 100), LONG),
            text('short', rect(300, 450, 100, 100), 'tiny'),
        ]), PATH, MIN);
        expect(cardsOf(docs)[0].groupChain).toEqual(['A', 'B', 'C']);
        const map = mapOf(docs).text;
        expect(map).toContain('# A\n');
        expect(map).toContain('## B\n');
        expect(map).toContain('### C\n');
        expect(sections(map)['A > B > C']).toEqual(['- tiny']);
    });

    it('a card partially outside a group is NOT a member', () => {
        const docs = extractCanvasDocs(canvas([
            group('g', rect(0, 0, 100, 100), 'G'),
            text('t', rect(50, 50, 100, 10), LONG),
        ]), PATH, MIN);
        expect(cardsOf(docs)[0].groupChain).toEqual([]);
    });

    it('a flush-snapped card within the px tolerance IS a member', () => {
        const docs = extractCanvasDocs(canvas([
            group('g', rect(0, 0, 100, 100), 'G'),
            text('t', rect(-GROUP_CONTAINMENT_TOLERANCE_PX, 0, 100 + GROUP_CONTAINMENT_TOLERANCE_PX, 100), LONG),
        ]), PATH, MIN);
        expect(cardsOf(docs)[0].groupChain).toEqual(['G']);
    });

    it('overlapping sibling groups both count, larger area first (deterministic)', () => {
        const nodes = [
            group('x', rect(0, 0, 500, 500), 'X'),
            group('y', rect(200, 200, 600, 600), 'Y'),
            text('t', rect(250, 250, 100, 100), LONG),
        ];
        expect(cardsOf(extractCanvasDocs(canvas(nodes), PATH, MIN))[0].groupChain).toEqual(['Y', 'X']);
        expect(cardsOf(extractCanvasDocs(canvas(nodes.reverse()), PATH, MIN))[0].groupChain).toEqual(['Y', 'X']);
    });

    it('a group whose label is whitespace-only is unlabelled (transparent)', () => {
        const docs = extractCanvasDocs(canvas([
            group('g', rect(0, 0, 100, 100), '   '),
            group('h', rect(10, 10, 50, 50), 'H'),
            text('t', rect(20, 20, 10, 10), LONG),
        ]), PATH, MIN);
        expect(cardsOf(docs)[0].groupChain).toEqual(['H']);
    });

    it('a multi-line group label collapses to one heading line', () => {
        const docs = extractCanvasDocs(canvas([
            group('g', rect(0, 0, 100, 100), 'Two\nline   label'),
            text('t', rect(10, 10, 10, 10), 'x'),
        ]), PATH, MIN);
        expect(mapOf(docs).text).toContain('# Two line label\n');
        expect(sections(mapOf(docs).text)['Two line label']).toEqual(['- x']);
    });

    it('a 7-deep chain caps map headings at level 6 but keeps the full chain on long cards', () => {
        const names = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
        const nodes: unknown[] = names.map((n, i) => group(n, rect(i * 10, i * 10, 1000 - i * 20, 1000 - i * 20), n));
        nodes.push(text('long', rect(100, 100, 10, 10), LONG));
        nodes.push(text('short', rect(100, 120, 10, 10), 'deep'));
        const docs = extractCanvasDocs(canvas(nodes), PATH, MIN);
        expect(cardsOf(docs)[0].groupChain).toEqual(names);
        const map = mapOf(docs).text;
        expect(map).toContain('###### G6\n');
        expect(map).toContain('###### G7\n');
        expect(map).not.toContain('#######');
        // The chunker's heading stack pops the equal-level G6 when G7 opens.
        expect(sections(map)['G1 > G2 > G3 > G4 > G5 > G7']).toEqual(['- deep']);
    });
});

describe('extractCanvasDocs — short/long classification on the CLEANED length', () => {
    it('a card of exactly minChunkChars cleaned chars is long; one char less is short', () => {
        const exact = 'x'.repeat(MIN);
        const under = 'x'.repeat(MIN - 1);
        const docs = extractCanvasDocs(canvas([
            text('a', rect(0, 0, 10, 10), exact),
            text('b', rect(0, 20, 10, 10), under),
        ]), PATH, MIN);
        expect(cardsOf(docs).map(d => d.nodeId)).toEqual(['a']);
        expect(sections(mapOf(docs).text)['']).toEqual([`- ${under}`]);
    });

    it('a long RAW card that cleans to empty (embeds only) goes to the map as its raw line', () => {
        const embeds = Array.from({ length: 12 }, (_, i) => `![[img${i}.png]]`).join('\n');
        expect(embeds.length).toBeGreaterThan(MIN);
        const docs = extractCanvasDocs(canvas([text('a', rect(0, 0, 10, 10), embeds)]), PATH, MIN);
        expect(cardsOf(docs)).toEqual([]);
        expect(sections(mapOf(docs).text)['']).toEqual([`- ${embeds.replace(/\n/g, ' ')}`]);
    });

    it('a short card\'s internal newlines collapse into one line', () => {
        const docs = extractCanvasDocs(canvas([text('a', rect(0, 0, 10, 10), 'Buy\n\nmilk\n')]), PATH, MIN);
        expect(sections(mapOf(docs).text)['']).toEqual(['- Buy milk']);
    });

    it('a short card starting with heading / fence / frontmatter / callout / table markers is prefixed, not structural', () => {
        const docs = extractCanvasDocs(canvas([
            text('a', rect(0, 0, 10, 10), '# Not a heading'),
            text('b', rect(0, 20, 10, 10), '```\ncode\n```'),
            text('c', rect(0, 40, 10, 10), '---\nkey: v\n---'),
            text('d', rect(0, 60, 10, 10), '> quoted'),
            text('e', rect(0, 80, 10, 10), '| a | b |\n|---|---|'),
        ]), PATH, MIN);
        const lines = mapOf(docs).text.split('\n').filter(Boolean);
        expect(lines).toHaveLength(5);
        for (const l of lines) expect(l.startsWith('- ')).toBe(true);
    });
});

describe('extractCanvasDocs — file and link nodes', () => {
    it('strips the directory and .md extension, keeps other extensions and the subpath', () => {
        const docs = extractCanvasDocs(canvas([
            file('a', rect(0, 0, 10, 10), 'Notes/Deep/Plan.md'),
            file('b', rect(0, 20, 10, 10), 'Assets/img.png'),
            file('c', rect(0, 40, 10, 10), 'Plan.md', '#^blk'),
        ]), PATH, MIN);
        expect(sections(mapOf(docs).text)['']).toEqual(['- [[Plan#^blk]]', '- [[Plan]]', '- [[img.png]]']);
    });

    it('items within a section are sorted by text, independent of node order (z-order drags rewrite the array)', () => {
        const nodes = [text('a', rect(0, 0, 10, 10), 'zeta'), text('b', rect(0, 20, 10, 10), 'alpha')];
        const forward = mapOf(extractCanvasDocs(canvas(nodes), PATH, MIN)).text;
        const reversed = mapOf(extractCanvasDocs(canvas([...nodes].reverse()), PATH, MIN)).text;
        expect(forward).toBe(reversed);
        expect(sections(forward)['']).toEqual(['- alpha', '- zeta']);
    });
});

describe('extractCanvasDocs — per-node type guards (never throw)', () => {
    it('non-numeric geometry ⇒ ungrouped; non-string text/label/file/url ⇒ skipped', () => {
        const docs = extractCanvasDocs(canvas([
            group('g', rect(0, 0, 1000, 1000), 'G'),
            { id: 'badgeo', type: 'text', x: '10', y: 10, width: 10, height: 10, text: LONG },
            { id: 'badtext', type: 'text', x: 10, y: 10, width: 10, height: 10, text: 42 },
            { id: 'badlabel', type: 'group', x: 5, y: 5, width: 900, height: 900, label: 7 },
            { id: 'badfile', type: 'file', x: 10, y: 10, width: 10, height: 10, file: null },
            { id: 'badurl', type: 'link', x: 10, y: 10, width: 10, height: 10, url: ['x'] },
            null,
            'not a node',
            { id: 'ok', type: 'text', x: 10, y: 30, width: 10, height: 10, text: 'fine' },
        ], 'not an array'), PATH, MIN);
        expect(cardsOf(docs)).toEqual([{ nodeId: 'badgeo', groupChain: [], text: LONG }]);
        const s = sections(mapOf(docs).text);
        expect(s['G']).toEqual(['- fine']);
        expect(Object.values(s).flat().filter(l => l.startsWith('- '))).toHaveLength(1);
    });

    it('a text node with a non-string id is skipped as a long card', () => {
        const docs = extractCanvasDocs(canvas([{ id: 9, type: 'text', x: 0, y: 0, width: 1, height: 1, text: LONG }]), PATH, MIN);
        expect(cardsOf(docs)).toEqual([]);
    });

    it('an edge with a non-string label or malformed shape is ignored; a labelled edge with no fromNode lands in the preamble', () => {
        const docs = extractCanvasDocs(canvas(
            [text('t', rect(0, 0, 10, 10), 'card')],
            [{ fromNode: 't', toNode: 't', label: 5 }, null, 'x', { label: 'no from' }],
        ), PATH, MIN);
        expect(sections(mapOf(docs).text)['']).toEqual(['- card', '- no from']);
    });
});
