// The OCR cache — one small JSON file per image CONTENT HASH, keyed by SHA-256
// of the image bytes (never the path), so a byte-identical copy under another
// name is never OCR'd twice and a rename/copy is a cache hit. It is the source
// of truth that lets every device derive byte-identical chunk text without
// re-running the engine (docs/research/image-ocr.md §3, §4).
//
// Layout (§3 / §9 Q3): `<sidecar index dir>/ocr/<sha256>.json`, the Text
// Extractor per-file shape with the key changed from md5(path) to the content
// hash. One file per hash → lazy reads (no startup parse), conflict-free under
// Obsidian Sync (two devices can only ever write IDENTICAL bytes to one path),
// and trivial listing for the status card. The cache is written whether or not
// the sidecar is enabled — it rides the sidecar's resolved directory only to
// inherit its Sync decisions, not its enablement.
//
// Lifetime (§12 D1/D2): records are KEPT when an image leaves the vault and are
// served REGARDLESS of engine/version/langs provenance — there is no automatic
// GC and no automatic miss on a provenance mismatch. Removal and re-OCR happen
// ONLY through the explicit Clear / Rebuild actions (§12 D8).
//
// Pure of Obsidian: the file surface is the small structural `OcrCacheAdapter`
// below (Obsidian's DataAdapter satisfies it), so the cache is unit-testable
// with an in-memory fake.

// SHA-256 of the image bytes as lower-case hex. `crypto.subtle.digest` is async,
// hardware-fast, and its input is already the ArrayBuffer `vault.readBinary`
// returns (§3). A real hash — not the 53-bit cyrb53 used for text chunk_ids —
// because a false hit on a content-addressed cache silently serves the WRONG
// image's text, the one place the collision cost is worth paying.
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const view = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0');
    return hex;
}

// The preprocessing that shaped the OCR output — recorded so a future engine can
// tell how the bytes were normalised before recognition (§3 record `pre`).
export interface OcrPreprocess { scale: number; maxEdge: number }

// The engine-produced half of a record: the fields `OcrEngine.ocr` returns for
// one image. `error` is set INSTEAD of usable text on a deterministic decode/OCR
// failure (§5 failure taxonomy); a text-free image is `text: ''` with `error:
// null`. tesseract.js confidences are 0-100 (§13); `conf` stores that scale.
export interface OcrResult {
    text: string;
    conf: number;
    w: number;        // decoded width in px
    hpx: number;      // decoded height in px
    ms: number;       // wall time the engine took
    error: string | null;
    pre: OcrPreprocess; // the resize the engine applied before recognition
}

// One cache record = an OcrResult plus its provenance (§3). Provenance is what
// the ticket asks to track; per §12 D2 it never causes a miss.
export interface OcrRecord extends OcrResult {
    h: string;             // key = SHA-256 of the image bytes
    engine: string;        // e.g. 'tesseract.js'
    v: string;             // engine version, e.g. '7.0.0'
    langs: string[];       // language packs in effect
    plugin: string;        // Seeker build that wrote the record
    ts: number;            // epoch ms the record was written
}

// The engine contract (§5). ONE call site (the pre-pass) ever invokes it; the
// runtime implementation (a srcdoc iframe hosting tesseract.js) lands in ticket
// 2/4, and tests use a double. The identity fields are the provenance the
// pre-pass stamps onto every record it writes.
export interface OcrEngine {
    readonly engine: string;   // e.g. 'tesseract.js'
    readonly version: string;  // e.g. '7.0.0'
    readonly langs: string[];  // language packs in effect
    ocr(bytes: ArrayBuffer): Promise<OcrResult>;
}

// The text a record contributes to the index. An `error` record and an
// empty-text record both contribute NOTHING (zero chunks, §4) — the file still
// gets a FileRecord with chunk_ids:[] so it reads 'clean' — while a text record
// contributes its text. Provenance is irrelevant to what is served (§12 D2).
export function ocrText(rec: OcrRecord): string {
    return rec.error !== null ? '' : rec.text;
}

// The vault-file surface the cache needs. A structural subset of Obsidian's
// DataAdapter so a fake can stand in; every method a real adapter provides.
export interface OcrCacheAdapter {
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
    remove(path: string): Promise<void>;
    mkdir(path: string): Promise<void>;
    stat(path: string): Promise<{ size: number } | null>;
}

// One entry of the status-card listing (§3 "OCR cache: N images, M MB").
export interface OcrCacheEntry { hash: string; bytes: number }

const OCR_SUBDIR = 'ocr';
const RECORD_RE = /^([0-9a-f]{64})\.json$/;

export class OcrCache {
    private readonly dir: string;   // `<sidecar index dir>/ocr`

    constructor(private readonly adapter: OcrCacheAdapter, sidecarIndexDir: string) {
        this.dir = `${sidecarIndexDir}/${OCR_SUBDIR}`;
    }

    private pathFor(hash: string): string {
        return `${this.dir}/${hash}.json`;
    }

    // Lazy read of ONE record. A missing file, or a torn/corrupt JSON (e.g. a
    // half-synced file), is a MISS — the caller treats a miss as UNKNOWN and
    // retries later, never as an error.
    async get(hash: string): Promise<OcrRecord | null> {
        const path = this.pathFor(hash);
        if (!(await this.adapter.exists(path).catch(() => false))) return null;
        try {
            return JSON.parse(await this.adapter.read(path)) as OcrRecord;
        } catch {
            return null;
        }
    }

    async has(hash: string): Promise<boolean> {
        return this.adapter.exists(this.pathFor(hash)).catch(() => false);
    }

    // Write a record. Obsidian's adapter.write does NOT create parent dirs, so
    // ensure `ocr/` first (idempotent). Content-addressed + write-once: two
    // devices only ever write identical bytes here, so no atomic rename is needed.
    async put(rec: OcrRecord): Promise<void> {
        await this.ensureDir();
        await this.adapter.write(this.pathFor(rec.h), JSON.stringify(rec));
    }

    // Every stored hash with its byte size — the one whole-set operation (status
    // card count + MB). Cheap at this scale (one small file per image).
    async list(): Promise<OcrCacheEntry[]> {
        if (!(await this.adapter.exists(this.dir).catch(() => false))) return [];
        const ls = await this.adapter.list(this.dir).catch(() => ({ files: [] as string[], folders: [] as string[] }));
        const out: OcrCacheEntry[] = [];
        for (const f of ls.files) {
            const m = RECORD_RE.exec(f.split('/').pop() ?? '');
            if (!m) continue;
            const st = await this.adapter.stat(f).catch(() => null);
            out.push({ hash: m[1], bytes: st?.size ?? 0 });
        }
        return out;
    }

    // Delete every record (§12 D8 "Clear OCR cache"). The image FileRecords are
    // dropped by search.ts's invalidation helper, not here — this owns only the
    // JSON files under `ocr/`.
    async clear(): Promise<void> {
        if (!(await this.adapter.exists(this.dir).catch(() => false))) return;
        const ls = await this.adapter.list(this.dir).catch(() => ({ files: [] as string[], folders: [] as string[] }));
        for (const f of ls.files) {
            if (RECORD_RE.test(f.split('/').pop() ?? '')) await this.adapter.remove(f).catch(() => {});
        }
    }

    private async ensureDir(): Promise<void> {
        try {
            if (!(await this.adapter.exists(this.dir).catch(() => false))) await this.adapter.mkdir(this.dir);
        } catch {
            /* already exists or unsupported — the write below surfaces a real failure */
        }
    }
}
