#!/usr/bin/env node
// Phase-0 OCR spike — fixture generator (ticket nid_cuu1jus7e29gcqcp7xycfxhz1_e,
// plan docs/research/image-ocr.md §12 D7).
//
//   node scripts/ocr-fixtures.mjs            # regenerate .out/ocr-fixtures/
//   OCR_FIXTURES_DIR=... node scripts/ocr-fixtures.mjs
//
// Renders HTML pages of KNOWN text and screenshots them, so the ground truth is
// EXACT, the corpus is licence-free and reproducible, and no human hand-checks
// anything. Nothing here is committed: .out/ is git-ignored (global excludes),
// the fixtures regenerate from this script, and the Phase-1 unit tests need no
// images (they hash arbitrary bytes). D7 caveat recorded in the doc: generated
// renders are cleaner than real photos/scans, so measured accuracy is an UPPER
// bound for photos and representative for the dominant case (UI/text shots).
//
// Varies what real screenshots vary (D7): font family, font size 10–24 px,
// light/dark theme, deviceScaleFactor 1 and 2, code blocks, tables, chat
// bubbles, plus JPEG-compressed and slightly-blurred variants.
//
// Output layout (OCR_FIXTURES_DIR, default .out/ocr-fixtures/):
//   <id>.png|jpg   the screenshot
//   <id>.txt       the exact ground-truth text (reading order)
//   index.json     [{ id, file, gt, kind, font, fontPx, theme, dpr, format, blur, w, h }]
// scripts/ocr-spike.mjs reads index.json and runs tesseract.js over each image.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveChromiumPath, BASE_CHROMIUM_ARGS } from '../bench/harness/browser.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_FIXTURES_DIR = '.out/ocr-fixtures';

function log(msg) { process.stderr.write(`ocr-fixtures: ${msg}\n`); }

// ── the known-text documents (ground truth is whatever we put here) ──────────
// Distinct, unambiguous words so a mis-OCR is unmistakable in the accuracy math.
// Each doc renders to a chunk of body HTML; `gt` is the exact reading-order text
// the recogniser should recover.
const PROSE = [
    'The quarterly retrieval review covered embedding throughput and ranking',
    'quality across the frozen corpus. Follow-up actions were assigned to the',
    'search team: verify the mobile memory budget, pin the padding ladder, and',
    'document the confidence thresholds before the next release milestone.',
].join(' ');

const CODE = [
    'function planResize(width, height) {',
    '  const longEdge = Math.max(width, height);',
    '  const scale = TARGET_EDGE / longEdge;',
    '  return { width: Math.round(width * scale) };',
    '}',
].join('\n');

const TABLE = [
    ['Metric', 'Baseline', 'Current'],
    ['accuracy', '0.71', '0.94'],
    ['latency', '1830', '640'],
    ['heapDelta', '162', '158'],
];

const CHAT = [
    'Did the screenshot index land in the nightly build?',
    'Yes, OCR runs as a desktop pre-pass now.',
    'Great, the phone just reads the synced cache.',
];

// Body-HTML builders. Each returns { html, gt }.
function proseDoc() {
    return { html: `<p>${PROSE}</p>`, gt: PROSE };
}
function codeDoc() {
    const esc = CODE.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return { html: `<pre>${esc}</pre>`, gt: CODE };
}
function tableDoc() {
    const rows = TABLE.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    return { html: `<table>${rows}</table>`, gt: TABLE.flat().join(' ') };
}
function chatDoc() {
    const bubbles = CHAT.map((m, i) => `<div class="bubble ${i % 2 ? 'them' : 'me'}">${m}</div>`).join('');
    return { html: `<div class="chat">${bubbles}</div>`, gt: CHAT.join(' ') };
}

const DOCS = { prose: proseDoc, code: codeDoc, table: tableDoc, chat: chatDoc };

// ── the fixture matrix — curated, NOT a full cross-product ────────────────────
// Enough to move each dimension independently (font size sweep on prose, both
// themes, both DPRs, mono code, table, chat, plus JPEG + blur degradations)
// while keeping the spike a few minutes, not an hour. `blur` is a CSS px radius.
const SANS = 'Arial, Helvetica, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = '"DejaVu Sans Mono", "Liberation Mono", monospace';

/** @type {Array<{id:string,kind:keyof typeof DOCS,font:string,fontPx:number,theme:'light'|'dark',dpr:number,format:'png'|'jpg',blur:number}>} */
export const FIXTURES = [
    // Font-size sweep (the §8c cap-height question) — prose, sans, light, dpr 1.
    { id: 'prose-sans-10-light-1x', kind: 'prose', font: SANS, fontPx: 10, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'prose-sans-12-light-1x', kind: 'prose', font: SANS, fontPx: 12, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'prose-sans-14-light-1x', kind: 'prose', font: SANS, fontPx: 14, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'prose-sans-18-light-1x', kind: 'prose', font: SANS, fontPx: 18, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'prose-sans-24-light-1x', kind: 'prose', font: SANS, fontPx: 24, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    // Serif + dark theme + high-DPR.
    { id: 'prose-serif-14-dark-1x', kind: 'prose', font: SERIF, fontPx: 14, theme: 'dark', dpr: 1, format: 'png', blur: 0 },
    { id: 'prose-serif-14-light-2x', kind: 'prose', font: SERIF, fontPx: 14, theme: 'light', dpr: 2, format: 'png', blur: 0 },
    { id: 'prose-sans-12-dark-2x', kind: 'prose', font: SANS, fontPx: 12, theme: 'dark', dpr: 2, format: 'png', blur: 0 },
    // Degradations on the small-prose worst case.
    { id: 'prose-sans-12-light-1x-jpg', kind: 'prose', font: SANS, fontPx: 12, theme: 'light', dpr: 1, format: 'jpg', blur: 0 },
    { id: 'prose-sans-12-light-1x-blur', kind: 'prose', font: SANS, fontPx: 12, theme: 'light', dpr: 1, format: 'png', blur: 0.6 },
    { id: 'prose-sans-14-dark-1x-jpg', kind: 'prose', font: SANS, fontPx: 14, theme: 'dark', dpr: 1, format: 'jpg', blur: 0 },
    // Code blocks (monospace) — light + dark, two sizes.
    { id: 'code-mono-12-light-1x', kind: 'code', font: MONO, fontPx: 12, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'code-mono-14-dark-1x', kind: 'code', font: MONO, fontPx: 14, theme: 'dark', dpr: 1, format: 'png', blur: 0 },
    { id: 'code-mono-14-light-2x', kind: 'code', font: MONO, fontPx: 14, theme: 'light', dpr: 2, format: 'png', blur: 0 },
    // Tables.
    { id: 'table-sans-13-light-1x', kind: 'table', font: SANS, fontPx: 13, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'table-sans-13-dark-1x', kind: 'table', font: SANS, fontPx: 13, theme: 'dark', dpr: 1, format: 'png', blur: 0 },
    // Chat bubbles.
    { id: 'chat-sans-14-light-1x', kind: 'chat', font: SANS, fontPx: 14, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'chat-sans-14-dark-1x', kind: 'chat', font: SANS, fontPx: 14, theme: 'dark', dpr: 1, format: 'png', blur: 0 },
    // DELIBERATELY DEGRADED worst cases: tiny text, heavy blur, aggressive JPEG.
    // Generated renders are otherwise too clean to produce OCR errors (D7), so
    // these anchor the low end of the accuracy/confidence relationship that the
    // §6 thresholds are set from — where wrong/dropped words show up as low
    // per-word and whole-image confidence.
    { id: 'prose-sans-8-light-1x', kind: 'prose', font: SANS, fontPx: 8, theme: 'light', dpr: 1, format: 'png', blur: 0 },
    { id: 'prose-sans-9-light-1x-blur', kind: 'prose', font: SANS, fontPx: 9, theme: 'light', dpr: 1, format: 'png', blur: 1.2 },
    { id: 'prose-sans-10-light-1x-jpgq20', kind: 'prose', font: SANS, fontPx: 10, theme: 'light', dpr: 1, format: 'jpg', blur: 0, quality: 20 },
    { id: 'code-mono-10-light-1x-blur', kind: 'code', font: MONO, fontPx: 10, theme: 'light', dpr: 1, format: 'png', blur: 1.0 },
];

// Full-page HTML for one fixture. Fixed content width so line breaks are stable;
// the recogniser sees a realistic column, not a single ultra-wide line.
function pageHtml(spec, bodyHtml) {
    const light = spec.theme === 'light';
    const bg = light ? '#ffffff' : '#1e1e1e';
    const fg = light ? '#202020' : '#dcdcdc';
    const bubbleMe = light ? '#d8ecff' : '#264f78';
    const bubbleThem = light ? '#eeeeee' : '#3a3a3a';
    const border = light ? '#cccccc' : '#555555';
    return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${bg}; }
  #card {
    width: 560px; padding: 20px; background: ${bg}; color: ${fg};
    font-family: ${spec.font}; font-size: ${spec.fontPx}px; line-height: 1.5;
    ${spec.blur ? `filter: blur(${spec.blur}px);` : ''}
  }
  p { margin: 0; }
  pre { margin: 0; white-space: pre; }
  table { border-collapse: collapse; }
  td { border: 1px solid ${border}; padding: 4px 10px; }
  .chat { display: flex; flex-direction: column; gap: 8px; }
  .bubble { padding: 8px 12px; border-radius: 10px; max-width: 80%; }
  .bubble.me { align-self: flex-end; background: ${bubbleMe}; }
  .bubble.them { align-self: flex-start; background: ${bubbleThem}; }
</style></head><body><div id="card">${bodyHtml}</div></body></html>`;
}

// Normalise ground truth to the reading-order token stream the accuracy math
// compares against. Whitespace-insensitive; keeps the raw text in the .txt file.
export function normalizeText(s) {
    return s.replace(/\s+/g, ' ').trim();
}

export async function generate({ outDir, executablePath, args, log: logFn = log }) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath, args });
    const index = [];
    try {
        // deviceScaleFactor is a context option, so group fixtures by DPR and
        // reuse one context per DPR rather than one per fixture.
        for (const dpr of [1, 2]) {
            const specs = FIXTURES.filter((f) => f.dpr === dpr);
            if (specs.length === 0) continue;
            const context = await browser.newContext({ deviceScaleFactor: dpr });
            const page = await context.newPage();
            for (const spec of specs) {
                const { html, gt } = DOCS[spec.kind]();
                await page.setContent(pageHtml(spec, html), { waitUntil: 'load' });
                const card = page.locator('#card');
                const box = await card.boundingBox();
                const file = `${spec.id}.${spec.format}`;
                const shotOpts = { path: join(outDir, file), scale: 'device' };
                if (spec.format === 'jpg') { shotOpts.type = 'jpeg'; shotOpts.quality = spec.quality ?? 55; }
                await card.screenshot(shotOpts);
                writeFileSync(join(outDir, `${spec.id}.txt`), gt + '\n');
                index.push({
                    id: spec.id, file, gt: normalizeText(gt), kind: spec.kind,
                    font: spec.font, fontPx: spec.fontPx, theme: spec.theme, dpr: spec.dpr,
                    format: spec.format, blur: spec.blur, quality: spec.quality ?? null,
                    // CSS px × dpr = the real pixel dimensions tesseract will decode.
                    w: Math.round((box?.width ?? 0) * dpr), h: Math.round((box?.height ?? 0) * dpr),
                });
                logFn(`${spec.id} → ${file} (${index[index.length - 1].w}×${index[index.length - 1].h}px)`);
            }
            await context.close();
        }
    } finally {
        await browser.close();
    }
    writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    return index;
}

async function main() {
    const outDir = resolve(REPO_ROOT, process.env.OCR_FIXTURES_DIR || DEFAULT_FIXTURES_DIR);
    const executablePath = resolveChromiumPath();
    const args = BASE_CHROMIUM_ARGS;
    log(`chromium=[${executablePath ?? 'playwright-bundled'}] out=[${outDir}]`);
    const index = await generate({ outDir, executablePath, args });
    log(`wrote ${index.length} fixtures + index.json to ${outDir}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch((e) => { log(e?.stack ?? String(e)); process.exit(1); });
}
