# Image OCR — research

Status: PLAN OF RECORD (research ticket `nid_5nfsr4yj8anp4jggh0uoc9bbt_e`,
2026-09-03). §9 records the human's decisions on Q1–Q6 and §12 on D1–D8, all
made 2026-09-03. §10 is the phasing; implementation tickets are linked from §10.
Plan review 2026-09-03 (against the code at `171f4b8`) corrected: the iframe is
NOT sandboxed (§5), OCR runs as a pre-pass rather than inline (§5), the
liveness oracles must not re-read image bytes every session (§4), and a
Rebuild/Clear must invalidate image FileRecords or the new text never reaches
the index (§4, §12 D8).

Ticket ask: make the text inside images that notes embed searchable. OPT-IN,
off by default. Never lose OCR work already done; key it by image content so a
byte-identical copy under another name is never OCR'd twice. The core question:
can this be added **without decreasing robustness** of the existing index.

## 1. Where images sit in the pipeline today: nowhere

- `src/indexable-file.ts` is the ONE gate: `.md` always, `.base` / `.canvas`
  behind a setting. Images are not files the indexer ever sees; the watcher in
  `main.ts` and the settings-tab total use the same gate.
- Every indexed file is read as TEXT (`vault.cachedRead`) and handed to
  `chunksFor(content, path, modifiedIso)` in `src/search.ts`, which branches on
  extension and pushes everything through `chunkContent`.
- Load-bearing invariant (canvas plan §2, `canvas-extractor.ts` header): **a
  file's chunk_ids are a pure function of the file's own bytes.** The sidecar
  hydrate path (`reChunkLive`, `collectLiveIds`) re-derives ids on every device,
  including query-only phones, by re-reading and re-chunking the live vault.
- Per-file dirtiness is `classifyFileDelta` over `(mtime, contentHash)` of the
  file's own bytes (`FileRecord.contentHash`, cyrb53 of the text).
- Heavy compute (embedding) runs on desktop only; a phone never bulk-embeds
  (jetsam rule, `main.ts` ~1142) and gets vectors through the sidecar.

OCR text is not in the file's bytes. That is the whole design problem: the
extracted text must come from somewhere the invariant and the phone can reach.

## 2. Two integration models

### 2a. Image as its OWN document (recommended)

The image file becomes an indexable file (`isIndexableFile` gains an `image`
case behind `indexImages`). Its document is: `title` = basename WITH
extension (`Whiteboard.png`, §12 D5), `content` = OCR text, `note_path` = the
image path. It rides
`chunkContent` unchanged (heading split is a no-op, the 512-token budget splits
a dense screenshot into parts, dense-clean and BM25 apply as they do to a note).

- chunk_id = `cyrb53(path, title, content)` exactly as for a note; the only
  novelty is that `content` is produced by OCR instead of read from disk.
- `FileRecord.contentHash` = hash of the image BYTES, so `classifyFileDelta`
  works untouched: an mtime re-stamp with identical bytes is 'clean', an
  actual image replacement is 'dirty'.
- Rename: the watcher's `rename` branch fires as for any file; the new path
  re-salts the chunk_id, so the (one or two) chunks re-embed — a few hundred ms
  — but OCR is a cache hit (§3). Exactly the rename/copy behaviour the ticket
  asks for.
- Result opening (decided, §9 Q2): which notes embed the image is answered
  READ-SIDE at open time from `metadataCache.resolvedLinks` (reverse lookup),
  never stored in the index — the same "resolve at read time, no reindex"
  pattern as `createdProp`. Exactly ONE referencing note → open that note,
  best-effort scrolled to the line holding the embed (locate the `![[...]]` /
  `![](...)` for that path in the raw text; the same guaranteed-open +
  best-effort-position split as `canvas-open.ts`). Zero or several referencing
  notes → `leaf.openFile(imageFile)` opens the image itself. The search-modal
  branch mirrors the `.base` / `.canvas` skip of the markdown highlight path.
- A byte-identical copy under two names is two documents. Each costs one
  cheap embed; OCR is shared through the cache. Accepted (no cross-path dedup
  in the index today either; a note pasted twice is two notes).

### 2b. Inline the OCR text into the EMBEDDING note's chunk (rejected)

Append the image's text to the chunk that contains `![[shot.png]]`. Superficially
"what the user wants" (hit lands on the note), but it breaks three things at
once:

1. The note's chunk_ids now depend on ANOTHER file's bytes. `reChunkLive` on a
   phone cannot re-derive them without the OCR text; the pure-function
   invariant is gone for every note that embeds an image.
2. Dirtiness becomes transitive: replacing `shot.png` must dirty every note
   that embeds it, but nothing bumps those notes' mtime. That needs a reverse
   dependency table and a second delta rule.
3. The 512-token budget: a screenshot yields 100–600 tokens; splicing that into
   a paragraph chunk forces splits and shifts every downstream chunk_id in the
   note, re-embedding the whole note on every OCR-engine change.

Model 2a keeps every existing invariant and answers "which note?" at read
time. Same reasoning the canvas plan used to refuse expanding `file` nodes.

## 3. The OCR cache — the ticket's hash idea, made concrete

Requirements the cache must meet (each one rules out a storage choice):

| requirement | consequence |
|---|---|
| survive a FULL reindex (nukes the IndexedDB stores) | NOT in the index DB |
| reachable on the phone for `reChunkLive` (§1 invariant) | a synced VAULT file |
| safe under iCloud / Obsidian Sync (no merge, conflict copies) | content-addressed files: two devices can only ever write IDENTICAL bytes to the same path, so a conflict copy is harmless |
| the phone must not load one giant blob at startup | one small file per image, read lazily only for images in the delta / re-chunk set |
| orphan cleanup when an image leaves the vault | one file per hash → removal is "delete files whose hash no live image has"; no compaction step. Per §12 D1 there is NO automatic GC — removal only via the explicit Clear (§12 D8) |
| keyed by bytes, not path (rename/copy proof) | content hash of the image bytes |
| never re-OCR the same bytes, even for "no text found" | store empty results too |
| tolerate a future engine upgrade | record carries `engine` + `v` + `langs` as provenance; a mismatch is still a HIT (§12 D2) — re-OCR only via Rebuild |

Shape (decided, §9 Q3): `<sidecar index dir>/ocr/<sha256>.json`, ONE
file per image hash — the Text Extractor layout, with the key changed from
md5(path) to the content hash. NOT the sidecar's per-device JSONL: the sidecar
needs per-device append logs because its records are device-PRODUCED vectors
with tombstones and compaction, while an OCR record is a pure function of the
bytes, identical whichever device wrote it. A log format there would only add
a whole-file parse at startup and a compaction step. Record:

```
{ "h": "<sha256>",                        // key = SHA-256 of the image bytes
  "engine": "tesseract.js", "v": "7.0.0", // WHAT produced the text (decided §9)
  "langs": ["eng", "deu"],                // language packs / model in effect
  "pre": { "scale": 2, "maxEdge": 3000 }, // preprocessing that shaped the output
  "plugin": "1.2.0",                      // Seeker build that wrote it
  "text": "...", "conf": 0.87,            // "" + conf 0 for a text-free image
  "w": 1440, "hpx": 900, "ms": 1830, "ts": 1756900000000,
  "error": null }                         // set instead of text on a decode/OCR failure
```

Provenance fields (`engine`, `v`, `langs`, `pre`, `plugin`) are what the
ticket asks to track. Hit rule: a record whose `engine`+`v`+`langs` differ
from the live configuration is still SERVED (the text is real, just older);
it is re-OCR'd only by an explicit "Rebuild OCR cache", never by a
setting change. That is the "never lose OCR work" guarantee, and it keeps a
language-setting edit from silently queueing a vault-wide re-OCR.

Location (Obsidian Sync is the design target): a sub-folder of the sidecar's resolved directory
(`resolveSidecarIndexDir()` in `main.ts`: the literal
`.obsidian/plugins/seeker/index` by default, the visible vault-root
`Seeker Index` folder when a split-config Obsidian Sync user has opted in).
Riding that one resolver means the OCR cache inherits every sync decision the
sidecar already fought for: the literal-`.obsidian` pin (a per-device
config-folder override must not fork the path), the Obsidian Sync steer notice,
and the file-move migration. A separate top-level hidden folder such as
`.plugin_data/seeker/ocr` was considered and rejected: Obsidian Sync carries
`.obsidian/` but not other dot-folders, so phones would never receive the text
and the §4 re-derivation would silently fail on every Sync vault, while
iCloud/Syncthing users would gain nothing they don't already have. Its one
merit, surviving a plugin uninstall (Obsidian deletes the plugin folder), is
shared with the sidecar today and costs only re-OCR time.
Obsidian Sync specifics that the per-file layout satisfies: every file is
KB-sized (far under the 5 MB per-file limit), a file is written once and
never modified (no version churn, no conflict copies), and the plugin folder
is carried by Sync's "Installed community plugins" option, which a sidecar
user already has on.

Reads are lazy (only the hashes the current pass or re-chunk touches), so a
10 000-image vault costs 10 000 small files in the plugin folder and no
startup parse. Caveat (§4): the liveness oracles DO touch every indexable
file each session, so "lazy" only holds if the oracle can get an image's
hash without re-reading its bytes — see §4. Directory listing via `adapter.list` is the one whole-set
operation (GC + settings-card count); it is cheap at this scale. An
undownloaded iCloud placeholder read throws like any vault file and takes the
existing unreadable-quarantine path.

Hash choice: SHA-256 via `crypto.subtle.digest` (async, hardware-fast, and the
input is already an `ArrayBuffer` from `vault.readBinary`). cyrb53 is kept for
text chunk_ids, but a 53-bit key on a content-addressed cache where a false hit
silently serves the WRONG text is the one place a real hash is worth its cost.
`FileRecord.contentHash` for an image stores the same SHA-256 (the field is an
opaque string; `classifyFileDelta` only compares).

Size: OCR text averages ~1–2 KB per screenshot; 10 000 images ≈ 10–20 MB in
the vault, comparable to today's sidecar. Acceptable, but it is user-visible
sync volume and belongs in the settings card ("OCR cache: N images, M MB").

Determinism bonus: the cache is also what makes chunk_ids agree across devices.
OCR output is deterministic for a given engine build, but wasm vs WebGPU float
paths can differ in the last decimal and flip a low-confidence word. Rule:
**the cache is the source of truth; a device that finds a record for the hash
NEVER re-runs OCR**, so exactly one device ever OCRs a given image and every
other device derives byte-identical text → identical chunk_ids.

## 4. What changes in the pure-function invariant

For images, "chunk_ids derivable from the file alone" becomes "from the file
bytes + the synced OCR cache". Consequences that must be handled explicitly:

- `reChunkLive` / `collectLiveIds` on a device whose cache has no record for an
  image's hash (desktop hasn't OCR'd it yet, or sync lag) must treat that file
  as UNKNOWN, not as "zero chunks": `collectLiveIds` already carries a
  completeness flag for read failures; a cache miss must set it the same way,
  or sidecar compaction would tombstone live ids.
- A text-free image (record with empty text) must persist a `FileRecord` with
  `chunk_ids: []` and its hash, or the zero-chunk path (which deletes the
  record) makes `computeDelta` re-read and re-hash the binary on every sweep.
  Today that path is fine for empty notes; for a 4 MB PNG × thousands it is not.
- The engine version is NOT part of `IndexIdentity`. No identity bump, no
  full reindex, ever, for OCR changes.
- **New OCR text does NOT reach the index by itself.** `classifyFileDelta`
  keys an image on its own bytes (`mtime` + SHA-256), and neither changes
  when the cache record is rewritten (Rebuild, engine bump, error retry). A
  "clean" file never reaches `chunksFor`, so a rewritten record would sit in
  the cache while the index kept the old chunks forever. Every path that
  rewrites a record for a LIVE image must therefore also drop that image's
  `FileRecord` + rows (`store.deleteFile(path)`, the same call the
  zero-chunk path uses) so the next pass treats it as never-indexed and the
  chunk-diff re-embeds it. §12 D8 defines the two user actions in these terms.
- **The liveness oracles must not re-read image bytes every session.**
  `reChunkLive`, `collectLiveIds`, `dedupViaSidecar`, `carryOverHydrate` and
  computeDelta's `check-bytes` branch all sweep EVERY indexable file (search.ts
  `cachedRead` sites). For notes that is a cheap text read; for a 10 000-image
  vault it would be gigabytes of binary reads + hashing per session on a phone.
  Rule: when the image's stored `FileRecord` has `mtimeMs === stat.mtime`,
  reuse the stored `contentHash` (the SHA-256) and read ONLY the small cache
  JSON; read + hash the bytes only when there is no record or the mtime moved
  (first hydrate on a fresh device pays the full read once). Same decision
  table as `classifyFileDelta`, reused, not duplicated.
- **Mobile cache miss in the index pass** (image dirty, no record yet because
  desktop has not OCR'd it or sync lags): skip the file WITHOUT quarantining
  it (quarantine is for persistently unreadable files and suppresses retries)
  and WITHOUT writing a `FileRecord`; it stays dirty and is retried on the
  next pass, when the record may have arrived. Bounded cost: one binary read
  + hash per such image per pass, only while the record is missing. Surface
  the count ("waiting for OCR from desktop: N") in the status card.

## 5. Runtime placement and the indexing pass

- OCR is desktop-only, like embedding. A phone reads the cache and never runs
  the engine (memory, thermals, the jetsam rule). Settings copy must say so.
- The engine lives in a SECOND srcdoc iframe (`seeker-ocr-iframe`),
  not inside the embed iframe: same CSP reason (`iframe-runner.ts` header), but
  its heap is independent, it can be unmounted the moment the OCR queue drains
  (releasing wasm memory without touching the ~100 MB warm embedder), and an
  engine crash / RPC timeout cannot take the embedder down. Reuse the
  `iframe-runner` RPC/timeout/recycle shape, not its code. **No `sandbox`
  attribute** — this is LOAD-BEARING in `iframe-runner.ts` and applies here
  identically: a sandboxed srcdoc iframe gets an opaque `null` origin, which
  breaks the Cache API (no core/lang-pack caching) and cross-origin fetches
  on iOS. "Isolated" in this doc means a separate srcdoc iframe with its own
  heap, never the HTML `sandbox` attribute.
- Decode happens INSIDE the OCR iframe, not in the plugin renderer: the
  parent transfers the raw `ArrayBuffer` (zero-copy `postMessage` transfer);
  the child decodes with `createImageBitmap`, applies the pure resize plan
  (`planResize(w, h)` — shared between parent tests and the child script the
  way the seq ladder is shared today) and feeds the bitmap to tesseract.js.
  The parent never holds a decoded bitmap, and the pure resize math is
  unit-testable in vitest (node has no `createImageBitmap`).
- Processing order (decided, §9 Q1): every raster image passing the ignore
  rules is in scope, but images referenced by at least one note are OCR'd
  FIRST, then the unreferenced rest. The referenced set comes from
  `metadataCache.resolvedLinks` at pass start and is used ONLY to sort the
  work queue — never for membership — so a link added or removed later
  changes nothing in the index and needs no metadata-cache event handling.
  This composes with the existing recency-first ordering as a second key
  (referenced first, then most-recent first within each group).
- Pass integration — OCR is a PRE-PASS, `contentFor` is cache-only.
  `chunksFor` is sync and takes a string. Add a `contentFor(file)` step ahead
  of it: `.md`/`.base`/`.canvas` → `cachedRead`; image → hash (per the §4
  no-re-read rule) → cache lookup → hit = text, miss = UNKNOWN on every
  platform (never a synchronous engine call). On desktop, before the embed
  loop of `reindexAll` / the delta path starts, an `ocrPrepass(files)` runs
  the engine over the pass's images that have no record, writes records, and
  tears the iframe down; the embed loop then sees only cache hits. This is
  what makes peak memory = max(engines) rather than the sum, keeps the
  engine touchpoint to ONE call site, and makes every chunk-production site
  (`reChunkLive`, `collectLiveIds`, `dedupViaSidecar`, `carryOverHydrate`,
  computeDelta `check-bytes`, `embedAndCommitFiles`) identical on desktop and
  phone. The pre-pass memoises `path → sha256` for the pass so the embed loop
  does not re-hash the same bytes. Pacing goes through the existing
  `pacer.ts` idle gate; a live query preempts it like an embed burst.
- Queue order inside the pre-pass (decided, §9 Q1): referenced images first,
  then unreferenced, most-recent-first within each group. Ordering only
  affects the pre-pass; the embed loop keeps its recency-first order.
- Decode: `Blob` → `createImageBitmap` (EXIF orientation applied by default,
  `resizeWidth/Height` resizes during decode) → OffscreenCanvas. Normalise the
  long edge into a 2000–3000 px window: UPscale small screenshots (Tesseract
  needs ~20–40 px cap-height, §8c), downscale scans and photos, and refuse
  anything above a pixel cap (a 139-megapixel image crashed Text Extractor).
- Formats: png / jpg / jpeg / gif (first frame) / webp / bmp are decodable in
  Electron. HEIC is not decodable in Chromium and iOS photos arrive as HEIC —
  skip by extension, count them in the settings card so the user knows.
  SVG: no OCR needed, `<text>` nodes are literal text in the XML — a cheap
  optional extractor later, out of scope here.
- Failure taxonomy (each outcome must be explicit; see §4 on why a record
  rewrite alone never re-chunks):
  - DETERMINISTIC per bytes (decode failure, pixel-cap reject): write an
    `error` cache record (final until Rebuild, §12 D8) AND a `FileRecord`
    with `chunk_ids: []` so the file reads 'clean'. Never retried
    automatically — the bytes will fail the same way next time.
  - TRANSIENT (engine load failure, RPC timeout, iframe crash): write NO
    cache record; commit the `FileRecord` with `chunk_ids: []` and
    `embedFailPluginVersion = PLUGIN_VERSION`, the existing quarantine field,
    so `classifyFileDelta` retries it once per plugin release (and Rebuild
    retries it on demand). Reuses the existing rule, adds no field.

## 6. Ranking pollution — the robustness risk that is NOT about crashes

OCR text is noisy: UI chrome ("File Edit View"), meme captions, timestamps,
partial words on a cropped edge. Every such chunk is a dense vector competing
with real notes, and the universal-near-neighbour hazard (`lexicalOnly` in
`types.ts`) applies to short garbage. Mitigations, cheapest first:

1. Engine confidence: drop words below a per-word confidence floor, drop the
   whole image when mean confidence or char count is below a threshold
   (thresholds to be measured in the spike, §10 phase 0). Tesseract exposes
   per-word confidence; ONNX-based engines expose per-line scores.
2. `minChunkChars` (50) already folds/drops tiny results; a "3 words on a
   button" image yields no chunk.
3. A hard cap on OCR text per image (e.g. 4 K chars) so a dense spreadsheet
   screenshot cannot become 8 vectors.
4. Title: `Pasted image 20240501123045` carries a date and nothing else; it is
   fine as a title (date filenames are how daily notes already title) but must
   not earn the 3.0× BM25 title boost for the word "image" — worth a check in
   the spike, not a new rule up front.

The dense weight, title boost and recency machinery are untouched; images are
just more documents.

## 7. Cost and time budget

- First enable on a vault with N images: N × (decode + OCR). Engine speeds are
  in §8; at ~1 s/image on desktop, 2 000 images ≈ 35 min of idle-gated
  background work. Resumable by construction (append-only cache, one
  `FileRecord` per image on commit) — a restart loses at most the image in
  flight. The settings card shows "OCR: 412 / 2 000".
- Steady state: only new/replaced images; a paste is one image, ~1 s.
- Download: a second remote fetch (engine wasm + language data, size per
  engine in §8) from the same CDN trust boundary as transformers.js, cached
  in the Cache API like the model.
- Sync: §3 size note.

## 8. Engine landscape (external survey, sources accessed 2026-09-03)

Everything must be fetched at runtime from a CDN into a srcdoc iframe (no `sandbox` attribute, §5)
(marketplace plugins ship only `main.js`) and run on CPU wasm or WebGPU. Cloud
is out. Figures marked UNVERIFIED had no primary source with hardware stated.

### 8a. Candidates

| engine | license | download | runtime | languages | screenshots | speed / image | notes |
|---|---|---|---|---|---|---|---|
| **tesseract.js 7.0.0** (2024-12) | Apache-2.0 | ~4 MB core+worker, + lang data (eng: 1.9 MB fast … 12 MB best) | wasm SIMD only, no GPU | 100+ | weak unless text is upscaled to 20–40 px cap-height; ~5–15 char-points behind PP-OCRv5 on modern fonts (3rd-party) | seconds-scale, UNVERIFIED | ~160 MB RSS for English; wasm heap never shrinks (issue #900) → tear the worker down after a pass; custom `workerPath/corePath/langPath` supported; needs Blob worker + remote `importScripts` + `wasm-unsafe-eval` in the iframe CSP |
| **PP-OCRv6-tiny / v5-mobile via `ppu-paddle-ocr/web`** | MIT (models Apache-2.0) | ~6 MB (v6 tiny det+rec) / ~21 MB (v5 mobile) + onnxruntime-web wasm | onnxruntime-web, WebGPU on Chromium with silent wasm fallback | 50+ in one v6 model; per-script v5 models | built for screenshots / scene text; 99.2 % chars on a receipt bench | ~150 ms on M1 in Node; browser UNVERIFIED | 2026 project, young; fetches models by URL (wrap in Cache API); browser build avoids OpenCV.js |
| `@paddleocr/paddleocr-js` (official, 2026-04) | Apache-2.0 | ~21 MB models + OpenCV.js | onnxruntime-web; needs COOP/COEP for threads | ch/en default | as above | 0.3–1.5 s (wrapper claim) | COOP/COEP is not something a srcdoc iframe can set; heavier deps |
| `@gutenye/ocr-browser` (PP-OCRv4) | MIT | ~16 MB | onnxruntime-web | ch+en | PP-OCRv4 | UNVERIFIED | last release 2024-12; not recommended |
| Florence-2-base-ft (transformers.js) | MIT | ~358 MB | WebGPU only (fp16) | English-centric | full-page OCR with regions | UNVERIFIED | 3.5× the embedding model; desktop-WebGPU only |
| TrOCR small (transformers.js) | MIT | ~64 MB q8 | wasm/WebGPU | English | line-level only; transformers.js has NO text detector | — | not a complete OCR |
| SmolVLM / SmolDocling 256M | Apache-2.0 | ~160 MB q4f16 | WebGPU | UNVERIFIED for OCR | generalist VLM | UNVERIFIED | no |
| Qwen2-VL / Qwen3-VL 2B | Qwen / Apache-2.0 | 1.4–2.6 GB | WebGPU | 32 languages | excellent server-side | UNVERIFIED | no |

### 8b. Prior art in Obsidian

- **Text Extractor** (scambier; the Omnisearch backend; AGPL-3.0; now
  unmaintained): tesseract.js 3.x from jsdelivr defaults, worker pool, optional
  macOS-native Vision via `osascript`. Cache = one JSON per image under the
  plugin folder, **keyed by md5(path)**, synced by the vault, `{path, text,
  libVersion, langs}`. Mobile is hard-gated to cache-only (`CANT_EXTRACT_ON_MOBILE`);
  the maintainer tried Android tesseract.js, hit "device not supported", closed
  won't-fix. Issues: 5 GB RAM / 90 % CPU with the worker pool (#18), renderer
  crash on a 139-megapixel image (#34, asks for a max-size cap).
- **OCR Extractor** (jritzi, MIT): bundled tesseract.js, one shared worker with
  concurrency 1, pre-resizes images to min 2000 / max 3000 px, writes text into
  the note rather than an index. Claims mobile works for the active note only.
- Native-binary plugins (obsidian-ocr, obsidian-tesseract-ocr, obsidian-image-ocr):
  desktop-only, need `tesseract` on PATH. Not applicable.

Text Extractor validates §3/§5 wholesale: desktop OCRs, a vault-synced cache
carries the text, phones only read. Its two weaknesses are exactly what this
design fixes: a **path-keyed** cache (rename or copy = re-OCR) and no image-size
cap / no worker teardown (the memory issues).

### 8c. Decode facts that shape §5

- HEIC is not decodable in Chromium or Electron on any platform (patent pools);
  WKWebView can, but phones never OCR here. Skip by extension and count.
- `createImageBitmap(blob, { resizeWidth, resizeHeight })` downscales during
  decode without a full-size canvas; `imageOrientation` defaults to
  `from-image` (EXIF applied) on Chromium 112+.
- Tesseract needs text at ~20–40 px cap-height, so screenshots must be
  UPSCALED 2–3×, not downscaled; PP-OCR is far less sensitive. Either way,
  normalise the long edge into a 2000–3000 px window (OCR Extractor's rule) and
  reject anything above a pixel cap (Text Extractor #34).

### 8d. Engine recommendation

Two candidates survive. Decision (§9 Q5): tesseract.js for V1, PP-OCR as the
follow-up (§11). The comparison is kept for that follow-up:

1. **PP-OCRv6-tiny via `ppu-paddle-ocr/web`** — preferred on paper: 6 MB vs
   Tesseract's 4 MB + language packs, multilingual in one model, WebGPU when
   present, screenshot-tolerant, sub-second. Risk: a months-old dependency with
   one maintainer, and its iframe-loadability (ESM from jsdelivr, onnxruntime-web
   wasm from the same CDN) is unproven — the same CDN/CSP shape as
   transformers.js, so the risk is bounded but must be demonstrated.
2. **tesseract.js 7** — the proven fallback: Apache-2.0, ten years of browser
   use, two Obsidian plugins already run it from the same CDN defaults. Costs:
   CPU-only, upscaling required, ~160 MB heap that must be torn down between
   passes, one language pack per language.

Everything transformers.js offers is either incomplete (TrOCR, no detector) or
3–25× larger than the embedding model and WebGPU-only (Florence-2, VLMs). Not
worth their weight for "find the screenshot that says X".

## 9. Decisions for the human

- **Q1 Scope of "image" — DECIDED 2026-09-03.** All raster images passing the
  ignore rules (a stateless gate like `.base`/`.canvas`), processed in priority
  order: images referenced by a note first, unreferenced images after. The
  reference set only orders the queue; membership never depends on other files'
  links, so the transitive-dirtiness problem of §2b does not arise.
- **Q2 Where a hit lands — DECIDED 2026-09-03.** One referencing note → open
  that note (best-effort scroll to the embed). Zero or several → open the image
  itself. Resolved at open time from resolvedLinks; the index stores nothing
  about referrers, so link edits never touch the index. Own-document-per-image
  (§2a) confirmed.
- **Q3 Cache format — DECIDED 2026-09-03.** One JSON file per image hash
  under `<sidecar index dir>/ocr/` (§3; location rationale there). The human's point stands: JSONL
  fits logs; a content-addressed cache wants per-key files (lazy reads, no
  startup parse, trivial GC, conflict-free by construction).
- **Q4 Language — DECIDED 2026-09-03: multilingual is a requirement, like the
  embedding model.** The engines differ in how they meet it: PP-OCRv6 covers
  50+ languages/scripts with its ONE default model, no setting at all;
  tesseract.js needs one 2–12 MB pack per language, no auto-detection, so it
  would need a language multi-select (default: Obsidian's locale + English).
  This is now the strongest argument for PP-OCR in Q5.
- **Q5 Engine — DECIDED 2026-09-03: tesseract.js 7 for V1.** Mature, Apache-2.0,
  already run from the same jsdelivr defaults by two Obsidian plugins; the
  fewest unknowns. PP-OCRv6-tiny is recorded as the follow-up optimisation
  (§11), not part of the initial implementation. V1 consequences: a language
  multi-select (one 2–12 MB pack per language, default Obsidian locale +
  English), screenshot upscaling, CPU-only pacing, and worker teardown after
  each pass. Bundling any engine as a plugin asset is not possible: a
  community-plugin install downloads exactly `main.js`, `manifest.json` and
  `styles.css` from the release (docs.obsidian.md, Submit your plugin);
  base64-embedding 4–6 MB into `main.js` would be evaluated on every start on
  every device. Runtime fetch + Cache API, as for the embedding model, is the
  only sane delivery — for tesseract.js and PP-OCR alike.
- **Q6 PDFs — DECIDED 2026-09-03.** Follow-up, not a conflict: the same
  architecture (document-of-its-own, content-keyed synced extraction cache)
  covers PDFs; they only add a page-render step before OCR and per-page
  chunks. Own ticket once images ship.

## 10. Recommended phasing (if approved)

- **Phase 0** (`nid_cuu1jus7e29gcqcp7xycfxhz1_e`) **— spike, bench-first** (like `docs/perf-bench.md`): a Playwright
  script over GENERATED screenshots of known text (§12 D7) running
  tesseract.js 7 inside a srcdoc iframe from jsdelivr, measuring per-image
  ms, heap delta, and word accuracy vs the exact ground truth at 1×/2×/3×
  upscale. Fixes the §6 confidence/char thresholds and the §5 resize window
  with numbers, and proves tesseract.js's worker mechanics (Blob worker +
  remote importScripts + wasm) load in a srcdoc iframe in Chromium. It does
  NOT run under Obsidian's real CSP — that check is the Phase-2 verify
  ticket. Keep the script, it is the harness the PP-OCR follow-up re-runs.
- **Phase 1** (`nid_kw23mrjlr2g4u56x96ierq100_e`) **— pure modules, tests first**: `ocr-cache.ts` (per-hash JSON
  record, get/put/list/clear, hit rules), `image-file.ts` (extension gate +
  pure `planResize`), `isIndexableFile` image case behind `indexImages`
  (default OFF), cache-only `contentFor` step routed through EVERY
  chunk-production site + `chunksFor` image branch, `FileRecord` for
  zero-chunk images, no-re-read rule for the oracles, unknown-on-miss,
  `OcrEngine` interface + test double, pre-pass queue ordering as a pure
  comparator.
- **Phase 2** (`nid_c9vuyt7b0e88sq8ljtu8b19le_e`) **— runtime**: OCR iframe runner (load, decode-in-child, RPC,
  timeout, recycle, teardown after drain), desktop-only `ocrPrepass` wiring
  ahead of the reindex/delta embed loops, failure taxonomy, settings toggle +
  language picker + status card (progress, cache count/MB, skipped
  heic/svg, waiting-for-desktop), Clear / Rebuild buttons (§12 D8), README.
  Followed by `nid_l89twli61ofcev3vablmht1h9_e` (see below): human check in a real Obsidian
  vault that the iframe loads under Obsidian's CSP.
- **Phase 3** (`nid_b4wvgo11kfiba3cojrj9q95cy_e`) **— UX**: search-modal image open branch (one referrer →
  note + best-effort scroll, else image), "in: Note" line, result row title
  with extension.

Non-goals for V1: mobile OCR, cloud OCR, handwriting, PDF. Follow-up tickets:
SVG text `nid_w5o7slkuv2qgl3oma5q9a4grh_e`, PP-OCR engine `nid_ybv5cljnxx9wb4ha2gbvpsbmd_e` (§11).

## 11. Follow-up optimisation: PP-OCRv6-tiny (not in V1)

Recorded so the V1 design leaves the door open, per §8d:

- Why: ~6 MB for ALL languages in one model (no language setting), WebGPU
  when present, built for screenshots (no upscaling), sub-second per image vs
  seconds for Tesseract. Multilingual-by-default is the decisive gain (Q4).
- What it changes: only the engine iframe and the `engine`/`v` fields of the
  cache record. The cache, gate, chunking, delta and open logic are
  engine-agnostic by design; a record with `engine: "tesseract"` remains valid
  (a hit is a hit), so switching engines re-OCRs nothing unless a "Rebuild OCR
  cache" is requested. The language setting becomes inert under PP-OCR.
- Delivery: runtime fetch of the det/rec ONNX files + onnxruntime-web wasm,
  cached in the Cache API like the embedding model. Host the model files on a
  URL this project controls (a GitHub Release of this repo, or a mirror HF
  repo under the author's account) rather than a third party's HF tree.
- Gate to adopt: the Phase-0 harness re-run on PP-OCR shows accuracy ≥
  Tesseract on the same screenshots, loads in the srcdoc iframe from a CDN
  without COOP/COEP, and the wrapper (`ppu-paddle-ocr`) is still maintained
  or is thin enough to vendor.

## 12. Second-round decisions (human, 2026-09-03)

- **D1 Cache lifetime.** A record is KEPT when its image leaves the vault
  (restore / undo / re-paste are free). Removal only via an explicit "Clear
  OCR cache" settings button. No automatic GC.
- **D2 Stale provenance.** A TEXT record whose engine / version / langs differ
  from the live configuration is served as-is; re-OCR only via an explicit
  "Rebuild OCR cache". A settings change never queues a vault-wide re-OCR.
  An `error` record is likewise final until Rebuild (deterministic failures
  only get an error record — §5 failure taxonomy; transient failures write no
  record and ride the existing per-release retry).
- **D3 V1 formats.** png, jpg/jpeg, webp, gif (first frame), bmp. svg is
  skipped (follow-up: XML `<text>` extraction, no OCR); heic is skipped
  (Chromium cannot decode). Skipped counts are shown in the settings card.
- **D4 Size guardrails.** Reject above a pixel cap (~25 MP) with an `error`
  record; normalise the long edge into a 2000–3000 px window, upscaling small
  screenshots for Tesseract. Exact numbers come from the Phase-0 spike.
- **D5 Result display.** Title keeps the extension (`Whiteboard.png`), matching
  canvas decision Q8; snippet is the OCR passage; a one-line "in: Note A" is
  shown when exactly one note references the image.
- **D6 Index-only.** OCR text is never written into notes.
- **D7 Spike inputs are GENERATED, not human-supplied.** A Playwright script
  renders HTML pages of known text and screenshots them, so the ground truth
  is exact, the fixtures are licence-free and reproducible, and no human has
  to hand-check anything. The corpus must vary what real screenshots vary:
  font family/size (10–24 px), light/dark theme, 1× and 2× device scale,
  code blocks, tables, chat bubbles, a few JPEG-compressed and slightly
  blurred variants. Caveat recorded: generated renders are cleaner than real
  photos/scans, so the measured accuracy is an upper bound for photos; it is
  representative for the dominant case (UI/text screenshots).
- **D8 Clear vs Rebuild (proposed in the 2026-09-03 plan review, pending
  human confirmation — see the review's `.out/current_decision.md`).** Both
  must invalidate image `FileRecord`s (§4) or the index keeps the old text.
  - "Clear OCR cache": delete every record under `ocr/` AND drop every image
    `FileRecord` + its rows from the local index (the index never holds text
    whose provenance is gone). With OCR on, the next desktop pass re-OCRs the
    live images lazily; with OCR off, this simply frees the synced space.
    This is also the ONLY orphan cleanup (D1).
  - "Rebuild OCR cache": Clear, then kick a catch-up pass immediately on this
    desktop. One mechanism, two entry points; no third "re-OCR but keep
    orphans" mode.
  - Neither button touches notes, bases, canvases or their vectors; neither
    is a full reindex.
