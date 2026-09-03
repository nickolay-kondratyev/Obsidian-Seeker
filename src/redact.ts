// Report redaction — the privacy valve on shared diagnostics (issue #5).
//
// The diagnostic report is the one artifact users are asked to paste into a
// public GitHub issue, and it carries two classes of private data: note paths
// (folder names alone can be disclosing) and query text (the user's own words).
// Reporters have hand-scrubbed both so far, which is laborious, error-prone,
// and — as issue #5 showed — a hard blocker: a user with a genuinely useful log
// declined to share the full file at all.
//
// WHY HASH INSTEAD OF DROP. Deleting paths destroys the signal that makes the
// log worth reading. "The same note is re-embedded every hour" and "56 chunks
// all came from one file" are only visible if identical paths stay identical
// across entries. So every identifier is replaced by a stable token derived
// from a per-report salt: correlation survives, the name does not. The salt is
// fresh per report, so tokens can't be matched across two reports from the same
// user, and a reader who guesses a vault's layout can't confirm it by hashing
// candidate paths (the salt isn't in the file).
//
// SHAPE IS KEPT WHERE IT'S DIAGNOSTIC. File extensions survive (`.md` vs
// `.base` vs `.canvas` selects a different chunker path, and issue #4-class
// bugs are extension-specific). Query text collapses to its length and word
// count — enough to correlate "long queries are slow" without the words.
//
// TWO PASSES, BELT AND BRACES. A key-driven policy handles the fields we know
// carry private data; a generic path-shaped-string scrub then sweeps EVERY
// remaining string leaf. The second pass is what makes this safe against schema
// drift — a future entry type that adds a path field is covered on the day it
// lands, without anyone remembering to update this file. Both passes run over
// the report copy only; the on-disk NDJSON is never rewritten.

import { cyrb53Hex } from './chunker';

// Keys whose values are file paths. Replaced by `note-<hash>.<ext>`.
// `devices`/`deviceId` are deliberately absent — device ids are already opaque
// random tokens and are load-bearing for multi-device triage.
const PATH_KEYS = new Set([
    'note_path', 'notePath', 'path', 'filePath', 'committedFilePaths',
    'includePaths', 'hydratedNotePaths', 'quarantinedPaths', 'deferredPaths',
]);

// Keys holding free text the user wrote or a note title. Replaced by a
// shape-only placeholder (query) or an opaque token (title, tag, value).
const QUERY_KEYS = new Set(['query', 'cleanedQuery']);
// `notes` is deliberately absent — it's the author-written free-text field on a
// benchmark profile entry, not user content, and hashing it would cost triage
// value for no privacy gain. The generic scrub still covers it.
const LABEL_KEYS = new Set(['title', 'displayTitle', 'snippet', 'viewName', 'link_terms']);

// Keys holding user vocabulary — tags, aliases, frontmatter keys and values.
// Hashed rather than dropped so "the same tag filter every time" still reads.
const VOCAB_KEYS = new Set(['tags', 'aliases', 'frontmatter', 'heading_path']);

// Subtrees that are user input END TO END. `filters` is the parsed form of what
// the user typed — tags, property names, compared values, excluded words, dates
// — so the rule is "everything under here is vocabulary" rather than a list of
// its leaves. QueryFilters has gained fields repeatedly (numeric, dateAfter,
// numericTypeMismatch, exclude); a leaf list would leak each new one until
// someone remembered this file.
const VOCAB_SUBTREE_KEYS = new Set(['filters']);
// …except the handful of structural leaves inside such a subtree, which carry
// no user content and are worth keeping legible.
const STRUCTURAL_IN_VOCAB = new Set(['op', 'tagsMatchAll']);

// Path-shaped string detectors for the generic sweep over free text.
//
// Vault paths routinely contain spaces ('1.5 Inbox/Private Journal.md'), so a
// segment MUST be allowed to hold them — an earlier space-free rule leaked
// every folder name that had one, matching only the last word before the
// extension. Allowing spaces means the match can also absorb the prose leading
// up to an unquoted path: `failed to read Notes/X.md` redacts to a bare token,
// losing "failed to read". That is the deliberate direction to fail in — this
// is a privacy control, and a quoted or clause-final path (what Node and
// Obsidian actually emit: `ENOENT: … open 'Notes/X.md'`) keeps its prose
// anyway, because quotes and colons terminate a segment.
//
// The slash-bearing form additionally REQUIRES a known extension, so structural
// values survive: `onnx-community/granite-embedding-…` is a model id, not a
// path, and redacting it would blind every embed triage. Absolute OS paths are
// matched without one — they leak the account name, and appear inside
// `app://local/…` model URLs.
const VAULT_EXT = String.raw`md|base|canvas|pdf|png|jpe?g|gif|webp|svg|txt|json|ndjson|csv|ya?ml`;
const SEG = String.raw`[^"'<>|:*?/\\\n]`;                 // one path segment; spaces allowed
const PATH_WITH_SLASH = new RegExp(
    String.raw`[A-Za-z]:\\[^\s"']+` +                      // C:\Users\…
    String.raw`|\/(?:Users|home|var|private|tmp)\/[^\s"']+` + // /Users/… (also inside app://local/…)
    String.raw`|(?:${SEG}+\/)+${SEG}+\.(?:${VAULT_EXT})\b`,   // 1.5 Inbox/Private Journal.md
    'g',
);
// Extension-bearing token with no folder above it. Kept space-free and applied
// only after the slash form, so it can't absorb prose: a bare filename in a log
// line is nearly always a plugin artifact, and those are allowlisted below.
const BARE_FILE = new RegExp(String.raw`[^\s"'<>|:*?/\\]+\.(?:${VAULT_EXT})\b`, 'g');

// Plugin-owned artifacts: fixed, public filenames that carry no vault
// structure. Redacting them turns "couldn't write seeker-report.json" into a
// riddle for no privacy gain. Only ever consulted for BARE_FILE matches —
// the same name under a folder (`…/logs/seeker-log-a1.ndjson`) does disclose
// structure and is handled by PATH_WITH_SLASH before we get here.
const OWN_ARTIFACT = /^seeker-[A-Za-z0-9._-]+$/;

export interface Redactor {
    /** `Notes/Trip Plans/Japan.md` → `note-3f9a21c4.md` */
    path(p: string): string;
    /** `where did I park` → `«query:16c/4w»` */
    query(q: string): string;
    /** A title, tag, or frontmatter value → `text-8b1d0e77` */
    label(s: string): string;
    /** Rewrite only the path-shaped substrings inside free text (error messages). */
    scrub(s: string): string;
}

// A redactor bound to one salt. Same input → same token for the life of a
// report; different across reports because the caller passes a fresh salt.
export function makeRedactor(salt: string): Redactor {
    const tok = (s: string) => cyrb53Hex(`${salt}\n${s}`).slice(0, 8);
    const path = (p: string): string => {
        // Keep the extension — it selects the chunker path and is never itself
        // identifying. Everything before it, including every folder name, goes.
        const m = /\.([A-Za-z0-9]{1,8})$/.exec(p);
        return m ? `note-${tok(p)}${m[0]}` : `note-${tok(p)}`;
    };
    const scrub = (s: string): string => s
        // Leading whitespace inside a match is prose spacing, not path — keep it
        // so redacting mid-sentence doesn't weld the token onto the prior word.
        .replace(PATH_WITH_SLASH, m => {
            const lead = /^\s*/.exec(m)![0];
            return lead + path(m.slice(lead.length));
        })
        .replace(BARE_FILE, m => (OWN_ARTIFACT.test(m) ? m : path(m)));
    return {
        path,
        scrub,
        label: (s: string) => `text-${tok(s)}`,
        // Length and word count are the only query properties any perf triage
        // has ever needed; the words themselves are the user's business.
        query: (q: string) => `«query:${q.length}c/${q.trim() ? q.trim().split(/\s+/).length : 0}w»`,
    };
}

// Deep-copy `value` with the redaction policy applied. `key` is the property
// name that held it ('' at the root), which is what drives the strong policy;
// unknown string leaves fall through to the conservative path-shaped scrub.
// `inVocab` is set once we've descended into a wholly-user-input subtree and
// stays set for the rest of the descent.
function redactValue(key: string, value: unknown, r: Redactor, inVocab = false): unknown {
    const vocab = inVocab || VOCAB_SUBTREE_KEYS.has(key);
    if (typeof value === 'string') {
        if (PATH_KEYS.has(key)) return r.path(value);
        if (QUERY_KEYS.has(key)) return r.query(value);
        if (LABEL_KEYS.has(key) || VOCAB_KEYS.has(key)) return r.label(value);
        if (vocab) return STRUCTURAL_IN_VOCAB.has(key) ? value : r.label(value);
        return r.scrub(value);
    }
    if (Array.isArray(value)) return value.map(v => redactValue(key, v, r, vocab));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            // A frontmatter map is `{ userKey: userValue }` — the KEYS are user
            // vocabulary too, so hash both sides rather than recursing by key
            // name (which would leak the key and match nothing in our sets).
            if (VOCAB_KEYS.has(key) && typeof v === 'string') { out[r.label(k)] = r.label(v); continue; }
            out[k] = redactValue(k, v, r, vocab);
        }
        return out;
    }
    return value;   // numbers, booleans, null, undefined — never identifying
}

// Redact a whole report entry list. Pure: returns new objects, leaves the
// caller's array (and the on-disk log it came from) untouched.
export function redactEntries<T>(entries: T[], salt: string): T[] {
    const r = makeRedactor(salt);
    return entries.map(e => redactValue('', e, r) as T);
}
