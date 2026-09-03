#!/usr/bin/env node
// Wholesale rename of the technical plugin id namespace `seek` → `seeker`
// (ticket nid_4emudvmyp2vaz9fug618fsmve_e). Covers manifest.id, the deep-link
// scheme, command ids, storage keys, the `seek-` CSS class namespace, TS
// identifiers (SeekSettings → SeekerSettings, seekTokenize → seekerTokenize) and
// build defines (__SEEK_ANALYZER_VERSION__).
//
// Kept in the repo (not a one-off) because Seeker is a fork: merging upstream
// Obsidian-Seek reintroduces `seek-` classes / `'seek'` literals, and a partial
// namespace silently breaks styling and storage scoping. Re-run after a merge.
// `rename-plugin-id.test.mjs` runs `--check` so CI catches strays.
//
// Usage:
//   node scripts/rename-plugin-id.mjs            apply
//   node scripts/rename-plugin-id.mjs --dry-run  print every changed line
//   node scripts/rename-plugin-id.mjs --check    exit 1 if anything would change
//
// WHY-NOT a plain `sed s/seek/seeker/`: the repo must keep (a) the upstream
// project name `Obsidian-Seek` and prose about the original "Seek" project,
// (b) English words (seeking, seeker), (c) `[[Seek Index ...]]` wiki links to
// vault notes, (d) history (tickets, changelog, change_log) and hashed test
// fixtures. The rules below encode exactly those exclusions.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Path prefixes / exact files never rewritten. Each is history, upstream
// attribution, or content whose bytes are pinned by tests.
const EXCLUDED_PATHS = [
    '_tickets/',        // ticket history describes the pre-rename state
    '_change_log/',     // ditto
    '.git_extra_data/', // branch bookkeeping
    'bench/corpus/',    // prose corpus; "seek" is an English word there
    'src/fixtures/',    // chunker fixtures whose chunk ids are hash-pinned in tests
    'README.md',        // upstream attribution + links into the original Seek docs
    'CHANGELOG.md',     // pre-fork entries deliberately describe the original Seek
    'LICENSE',          // upstream copyright line
    'package-lock.json',
    'scripts/rename-plugin-id.mjs',
    'scripts/rename-plugin-id.test.mjs',
];

// Each rule: [pattern, replacement]. Lookarounds keep intact: `seeker`/`seeking`
// (lowercase letter follows), prose "seek"/"Seek" (space follows — comments quote
// upstream note titles like "Seek Retrieval Relevance & Query.md" and the
// upstream docs URL), `Obsidian-Seek`, and `[[Seek ...]]` wiki links.
const RULES = [
    // seek-foo, seek:search, 'seek', [seek], obsidian://seek?, seekTokenize. NOT: seeker, seeking, "seek plan"
    [/(?<![A-Za-z])seek(?![a-z ])/g, 'seeker'],
    // Deep-link scheme and plugin folder in prose (space may follow): obsidian://seek deep-link, .obsidian/plugins/seek folder
    [/(?<=obsidian:\/\/|\/plugins\/)seek(?![a-z])/g, 'seeker'],
    // Identifier prefix only: SeekSettings, SeekLogger, openSeekSettings. NOT: prose "Seek ...", Obsidian-Seek
    [/(?<!Obsidian-)Seek(?=[A-Z])/g, 'Seeker'],
    // The visible vault-root index folder literal ('Seek Index/', "Seek Index"), which at runtime is
    // `${manifest.name} Index`. NOT: [[Seek Index Processing Audit]] / "Seek Index Size ..." note titles (space follows)
    [/Seek Index(?=[\/'"])/g, 'Seeker Index'],
    // __SEEK_ANALYZER_VERSION__
    [/(?<![A-Za-z])SEEK(?![A-Za-z])/g, 'SEEKER'],
];

function trackedTextFiles() {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
    return out.split('\0').filter(Boolean).filter((p) => !EXCLUDED_PATHS.some((ex) => p === ex || p.startsWith(ex)));
}

// Strict decode: binary files fail and are skipped. WHY-NOT a NUL-byte sniff:
// src/tokenize.ts legitimately contains raw control characters (NUL included)
// inside a character class, and a NUL sniff silently skipped it.
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
function decodeUtf8OrNull(buf) {
    try { return UTF8_STRICT.decode(buf); } catch { return null; }
}

function rewrite(text) {
    return RULES.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

function changedLines(before, after) {
    const a = before.split('\n'), b = after.split('\n');
    const lines = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) lines.push({ line: i + 1, before: a[i], after: b[i] });
    return lines;
}

function main(argv) {
    const dryRun = argv.includes('--dry-run');
    const check = argv.includes('--check');
    let filesChanged = 0, linesChanged = 0;
    for (const rel of trackedTextFiles()) {
        const abs = path.join(REPO_ROOT, rel);
        const before = decodeUtf8OrNull(readFileSync(abs));
        if (before === null) continue; // binary
        const after = rewrite(before);
        if (after === before) continue;
        const diff = changedLines(before, after);
        filesChanged++; linesChanged += diff.length;
        if (dryRun || check) {
            console.log(`--- ${rel} (${diff.length} lines)`);
            if (dryRun) for (const d of diff) console.log(`  ${d.line}:\n    - ${d.before.trim()}\n    + ${d.after.trim()}`);
        } else {
            writeFileSync(abs, after);
        }
    }
    const verb = dryRun ? 'would change' : check ? 'still contain seek namespace' : 'rewrote';
    console.log(`rename-plugin-id: ${verb} files=[${filesChanged}] lines=[${linesChanged}]`);
    if (check && filesChanged > 0) process.exit(1);
}

main(process.argv.slice(2));
