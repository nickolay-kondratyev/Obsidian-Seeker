#!/usr/bin/env node
// Frozen e2e retrieval-quality dataset generator (plan nid_dfk1ncuuf6zsfsszu2rzuwdws_e,
// ticket nid_4wklzxci3244xy0dv1knvjc20_e — part 1 of 3).
//
// Builds a small, COMMITTED, FROZEN subset of BEIR CQADupstack-android
// (StackExchange duplicate-question pairs) that the e2e suite indexes through
// the real embedding stack. "Frozen" means: regenerating this re-pins the e2e
// baseline, exactly like bench/corpus (see e2e/datasets/cqadupstack-android/README.md).
//
//   npm run build:e2e-dataset
//
// Deterministic (seeded PRNG below) and idempotent: a second run downloads
// nothing (cached under .tmp/e2e-dataset/) and produces a byte-identical diff.
//
// This file is plain Node with no new deps: it CANNOT import src/query-parser.ts
// (TS, imports the Obsidian runtime shim), so query eligibility uses a
// deliberately CONSERVATIVE regex here and the pin test
// (e2e/datasets/cqadupstack-android.test.ts) is the authoritative check with the
// real parseQuery. Exported constants below are imported by that pin test so the
// numbers live in one place (DRY).

import { mkdirSync, existsSync, createWriteStream, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');
const DOWNLOAD_DIR = join(REPO_ROOT, '.tmp', 'e2e-dataset');
const OUTPUT_DIR = join(REPO_ROOT, 'e2e', 'datasets', 'cqadupstack-android');

// PINNED mirror commit (NOT `resolve/main`, which can move): byte-identical
// regeneration years from now. Verified 2026-09-03. See the plan's "Key facts".
const MIRROR_BASE_URL =
    'https://huggingface.co/datasets/mteb/cqadupstack-android/resolve/e03f271e3f4a75f49787c838a62f671b35bc9004/';
const CORPUS_FILE = 'corpus.jsonl';
const QUERIES_FILE = 'queries.jsonl';
const QRELS_FILE = 'qrels/test.tsv';

// Seed for the reproducible sample. Any change here re-pins the e2e baseline.
export const SEED = 20260903;

// --- Eligibility rules (a query failing ANY rule is SKIPPED, never "fixed") ---

// Relevant-doc count from qrels must be <= this. WHY: one query has 262 relevant
// docs and several have 20-50; the TARGET_DOCS budget cannot hold "all relevant
// docs" of such a query. 508 of 699 queries have exactly one relevant doc.
export const MAX_RELEVANT_PER_QUERY = 5;

// Every relevant doc's `title + text` must be <= this many chars (also applied to
// distractors). WHY: the longest doc is 27,830 chars; capped at <= 2,000 the real
// MarkdownChunker makes exactly one chunk per note (measured 2026-09-03: 150 docs
// -> 150 chunks), which is what the 1-minute container budget assumes.
export const MAX_DOC_CHARS = 2000;

// --- Sample size ---

// Number of eligible test queries kept. WHY 30/150: 1-minute container budget at
// ~4 chunks/s wasm (docs/perf-bench.md).
export const QUERY_COUNT = 30;

// Total docs in the frozen corpus (all chosen queries' relevant docs + seeded
// distractors up to this count).
export const TARGET_DOCS = 150;

// A query whose text would be REWRITTEN by the plugin's inline-filter parser
// (src/query-parser.ts) is not a fair retrieval test — `-word` is note-level
// negation and `[k:v]` a frontmatter filter in Seeker. This CONSERVATIVE regex
// rejects any text with (start|whitespace) followed by `-`, `#`, `tag:`, `path:`,
// `after:`, or `before:`, or containing any `[`. The pin test re-checks every
// kept query with the REAL parseQuery (authoritative). 5 of 699 queries hit this
// (e.g. "Battery -life?", "[RPC:S-7:AEC-0]").
const INLINE_FILTER_HAZARD_RE = /(?:^|\s)(?:-|#|tag:|path:|after:|before:)|\[/;

// mulberry32: a tiny, well-distributed seeded PRNG. Deterministic across Node
// versions (pure integer math), so the committed sample is reproducible.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// In-place Fisher-Yates shuffle driven by the seeded PRNG.
function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Numeric-id comparator (ids are numeric strings; sort them as numbers so the
// output order is human-obvious rather than lexical "10" < "2").
const byNumericId = (a, b) => Number(a) - Number(b);

async function downloadIfMissing(remotePath, localPath) {
    if (existsSync(localPath)) {
        console.log(`skip download (cached): ${remotePath}`);
        return;
    }
    mkdirSync(dirname(localPath), { recursive: true });
    const url = MIRROR_BASE_URL + remotePath;
    console.log(`download: ${url}`);
    const res = await fetch(url); // follows redirects by default (mirror 302/307s to a CDN)
    if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(localPath));
}

// Parse a JSONL file into an array of objects (one per non-empty line).
function readJsonl(localPath) {
    return readFileSync(localPath, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
}

// Parse qrels/test.tsv (header `query-id<TAB>corpus-id<TAB>score`) into a map
// query-id -> Set<corpus-id>. Every score is 1 (binary relevance); we keep every
// row (score is ignored).
function readQrels(localPath) {
    // The mirror serves this TSV with CRLF line endings; strip the trailing \r.
    const lines = readFileSync(localPath, 'utf8')
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => l.length > 0);
    const header = lines.shift();
    if (header !== 'query-id\tcorpus-id\tscore') throw new Error(`unexpected qrels header: [${header}]`);
    const relevant = new Map();
    for (const line of lines) {
        const [queryId, corpusId] = line.split('\t');
        if (!relevant.has(queryId)) relevant.set(queryId, new Set());
        relevant.get(queryId).add(corpusId);
    }
    return relevant;
}

function docChars(doc) {
    return (doc.title + doc.text).length;
}

async function main() {
    // 1. Download (idempotent).
    await downloadIfMissing(CORPUS_FILE, join(DOWNLOAD_DIR, CORPUS_FILE));
    await downloadIfMissing(QUERIES_FILE, join(DOWNLOAD_DIR, QUERIES_FILE));
    await downloadIfMissing(QRELS_FILE, join(DOWNLOAD_DIR, QRELS_FILE));

    // 2. Load.
    const corpus = new Map(); // id -> { title, text }
    for (const row of readJsonl(join(DOWNLOAD_DIR, CORPUS_FILE))) {
        corpus.set(row._id, { title: row.title ?? '', text: row.text ?? '' });
    }
    const queryText = new Map(); // id -> text
    for (const row of readJsonl(join(DOWNLOAD_DIR, QUERIES_FILE))) {
        queryText.set(row._id, row.text);
    }
    const relevant = readQrels(join(DOWNLOAD_DIR, QRELS_FILE));

    // 3. Eligibility. Sort the distinct qrels query ids first so the shuffle is
    //    reproducible regardless of file order.
    const isEligible = (queryId) => {
        const text = queryText.get(queryId);
        if (text === undefined) return false;
        const rel = [...relevant.get(queryId)];
        // MAX_RELEVANT_PER_QUERY.
        if (rel.length > MAX_RELEVANT_PER_QUERY) return false;
        // Query text must survive the inline-filter parser unchanged.
        if (INLINE_FILTER_HAZARD_RE.test(text)) return false;
        for (const corpusId of rel) {
            const doc = corpus.get(corpusId);
            if (doc === undefined) return false; // a relevant doc missing from the corpus
            // MAX_DOC_CHARS (relevant docs).
            if (docChars(doc) > MAX_DOC_CHARS) return false;
            // No relevant doc whose title equals the query text case-insensitively
            // (a verbatim title match is not a retrieval test).
            if (doc.title.trim().toLowerCase() === text.trim().toLowerCase()) return false;
        }
        return true;
    };

    const rng = mulberry32(SEED);
    const allQueryIds = [...relevant.keys()].sort(byNumericId);
    const shuffledQueryIds = shuffle([...allQueryIds], rng);

    // 4. Take the first QUERY_COUNT eligible queries from the shuffled order.
    const chosenQueries = [];
    for (const queryId of shuffledQueryIds) {
        if (chosenQueries.length >= QUERY_COUNT) break;
        if (isEligible(queryId)) chosenQueries.push(queryId);
    }
    if (chosenQueries.length < QUERY_COUNT) {
        throw new Error(`only ${chosenQueries.length} eligible queries, need ${QUERY_COUNT}`);
    }

    // 5. Collect ALL chosen queries' relevant corpus ids.
    const relevantDocs = new Set();
    for (const queryId of chosenQueries) {
        for (const corpusId of relevant.get(queryId)) relevantDocs.add(corpusId);
    }
    if (relevantDocs.size > TARGET_DOCS) {
        throw new Error(`relevant set (${relevantDocs.size}) exceeds TARGET_DOCS (${TARGET_DOCS})`);
    }

    // 6. Fill with seeded-random distractors: docs not relevant to any chosen
    //    query and within MAX_DOC_CHARS. Sort candidate ids first for a
    //    reproducible shuffle.
    const distractorCandidates = [...corpus.keys()]
        .filter((id) => !relevantDocs.has(id) && docChars(corpus.get(id)) <= MAX_DOC_CHARS)
        .sort(byNumericId);
    shuffle(distractorCandidates, rng);
    const finalDocs = new Set(relevantDocs);
    for (const id of distractorCandidates) {
        if (finalDocs.size >= TARGET_DOCS) break;
        finalDocs.add(id);
    }
    if (finalDocs.size < TARGET_DOCS) {
        throw new Error(`only ${finalDocs.size} docs available, need ${TARGET_DOCS}`);
    }

    // 7. Write output. Wipe the folder first so a regeneration never leaves stale
    //    files.
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    const corpusOutDir = join(OUTPUT_DIR, 'corpus');
    mkdirSync(corpusOutDir, { recursive: true });
    for (const id of [...finalDocs].sort(byNumericId)) {
        const doc = corpus.get(id);
        writeFileSync(join(corpusOutDir, `${id}.md`), `# ${doc.title}\n\n${doc.text}\n`);
    }

    const queriesJson = chosenQueries
        .map((id) => ({
            id,
            text: queryText.get(id),
            relevant: [...relevant.get(id)].sort(byNumericId),
        }))
        .sort((a, b) => byNumericId(a.id, b.id));
    writeFileSync(join(OUTPUT_DIR, 'queries.json'), JSON.stringify(queriesJson, null, 2) + '\n');

    writeFileSync(join(OUTPUT_DIR, 'README.md'), readmeContents());
    writeFileSync(join(OUTPUT_DIR, 'LICENSE-DATA.md'), licenseContents());

    console.log(
        `wrote ${finalDocs.size} docs (${relevantDocs.size} relevant + ${finalDocs.size - relevantDocs.size} distractors) and ${chosenQueries.length} queries to ${OUTPUT_DIR}`,
    );
}

function readmeContents() {
    return `# e2e retrieval dataset — CQADupstack-android subset (FROZEN)

A seeded-random subset of BEIR **CQADupstack-android** (StackExchange
duplicate-question pairs) used as the ground truth of the retrieval-quality e2e
suite (plan \`nid_dfk1ncuuf6zsfsszu2rzuwdws_e\`). Everything under this folder is
git-tracked third-party **test data**, not plugin code, and is NOT under the
repo's MIT license — see [\`LICENSE-DATA.md\`](./LICENSE-DATA.md).

## Freeze rule

**Do not hand-edit, add, remove or rename files here.** The e2e baseline is
measured against exactly this content; any change shifts chunk counts, rankings
and metrics and silently invalidates the pinned baseline. To change it, re-run
the generator (which re-pins the baseline) — never edit by hand. In the spirit of
\`bench/corpus/README.md\`: treat a regeneration as a new dataset and re-capture
the e2e baseline.

## Layout

- \`corpus/<corpus-id>.md\` — one note per doc, \`# <title>\` + body. No
  frontmatter, no invented metadata.
- \`queries.json\` — \`[{ "id", "text", "relevant": ["<corpus-id>", ...] }]\`,
  sorted by id, \`relevant\` sorted.

## How it was generated

\`node scripts/build-e2e-dataset.mjs\` (\`npm run build:e2e-dataset\`). It downloads
the mirror's PINNED commit
\`e03f271e3f4a75f49787c838a62f671b35bc9004\` of
https://huggingface.co/datasets/mteb/cqadupstack-android (\`corpus.jsonl\`,
\`queries.jsonl\`, \`qrels/test.tsv\`) into \`.tmp/e2e-dataset/\`, then samples with a
seeded PRNG (mulberry32, \`SEED\` in the script). The script is deterministic and
idempotent: a second run downloads nothing and produces an identical diff.

## Eligibility rules

A query is SKIPPED (never "fixed") when ANY rule fails:

- **<= ${MAX_RELEVANT_PER_QUERY} relevant docs** (\`MAX_RELEVANT_PER_QUERY\`): the
  ${TARGET_DOCS}-doc budget cannot hold a query with 20-262 relevant docs.
- **every relevant doc's \`title + text\` <= ${MAX_DOC_CHARS} chars**
  (\`MAX_DOC_CHARS\`, also applied to distractors): at this cap the real chunker
  makes exactly one chunk per note, which the 1-minute budget assumes.
- **query text survives the inline-filter parser unchanged**: \`-word\`,
  \`[k:v]\`, \`#tag\`, \`tag:\`/\`path:\`/\`after:\`/\`before:\` would be rewritten by
  Seeker's \`parseQuery\` and are not a fair retrieval test. The pin test
  (\`e2e/datasets/cqadupstack-android.test.ts\`) re-checks every query with the
  real parser.
- **no relevant doc whose title equals the query text** (case-insensitively): a
  verbatim title match is not a retrieval test.

## The sample

${QUERY_COUNT} eligible queries; all their relevant docs plus seeded-random
distractors up to ${TARGET_DOCS} docs total.
`;
}

function licenseContents() {
    return `# Data license — CQADupstack-android subset

The content under this folder (\`corpus/*.md\` and the query text in
\`queries.json\`) is **StackExchange user contributions**, licensed
**CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/).

It was packaged as the **CQADupstack** subset of **BEIR** (Thakur, Reimers, Rücklé,
Srivastava, Gurevych, *"BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of
Information Retrieval Models"*, NeurIPS 2021 —
https://github.com/beir-cellar/beir), and mirrored as plain JSONL by **MTEB** at
https://huggingface.co/datasets/mteb/cqadupstack-android (pinned commit
\`e03f271e3f4a75f49787c838a62f671b35bc9004\`), which this repo downloads from.

This test-data folder is therefore **NOT covered by the repository's MIT
license**. It is redistributed under CC BY-SA 4.0; downstream use must keep that
attribution and share-alike.
`;
}

// Guarded (bench/harness/run.mjs pattern) so the pin test can import the exported
// constants without triggering a download.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch((e) => {
        console.error(e?.stack ?? String(e));
        process.exit(1);
    });
}
