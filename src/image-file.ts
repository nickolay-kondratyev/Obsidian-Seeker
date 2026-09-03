// The image half of Seeker's indexable-file gate: which raster files OCR can turn
// into search documents, and the pure decode-resize plan the OCR iframe applies.
//
// Pure and Obsidian-free (paths + numbers only) so it is unit-testable in vitest
// and SHARED between the parent (tests, pre-pass ordering) and the OCR iframe
// child, exactly the way the seq ladder is shared today. NO `createImageBitmap`
// here — decoding happens inside the OCR iframe (ticket 2/4) where a real
// decoder exists; node/vitest has none.
//
// Plan of record: docs/research/image-ocr.md §12 D3 (formats), §12 D4 + §13
// (resize window + pixel cap), §9 Q1 / §5 (queue ordering).

// V1 raster formats decodable in Electron/Chromium (§12 D3, §5). Lower-case; the
// caller lower-cases the extension before testing.
export const INDEXABLE_IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

// Raster/vector images we DELIBERATELY do not index but still want to count for
// the status card (§12 D3): svg needs XML `<text>` extraction not OCR (follow-up
// nid_w5o7slkuv2qgl3oma5q9a4grh_e); heic is undecodable in Chromium.
export const SKIPPED_IMAGE_EXTENSIONS: readonly string[] = ['svg', 'heic'];

// ── Resize window + pixel cap (§12 D4, §13 spike constants) ──────────────────
// Normalise the long edge into [2000, 3000] px: UPSCALE screenshots below 2000
// (Tesseract needs ~20-40 px cap-height, §8c; the spike measured the accuracy
// gain realised by ~2× and plateauing by 3×), DOWNSCALE scans/photos above 3000,
// leave the middle untouched.
export const RESIZE_MIN_LONG_EDGE_PX = 2000;
export const RESIZE_MAX_LONG_EDGE_PX = 3000;
// Refuse anything above this many source pixels with a deterministic `error`
// record — a 139-megapixel image crashed Text Extractor's renderer (#34, §12 D4).
export const PIXEL_CAP = 25_000_000;

export function isIndexableImageExtension(extension: string): boolean {
    return INDEXABLE_IMAGE_EXTENSIONS.includes(extension.toLowerCase());
}

export function isIndexableImagePath(path: string): boolean {
    const ext = path.split('.').pop();
    return ext !== undefined && isIndexableImageExtension(ext);
}

export function isSkippedImageExtension(extension: string): boolean {
    return SKIPPED_IMAGE_EXTENSIONS.includes(extension.toLowerCase());
}

// The pure resize plan the OCR iframe feeds to `createImageBitmap`'s
// resizeWidth/Height (§5). `scale` is the multiplier applied to BOTH dimensions
// so aspect ratio is preserved; `targetW`/`targetH` are the decoded bitmap size.
// A source above the pixel cap is rejected outright (the child writes an `error`
// record and never decodes it) — checked on the SOURCE pixels, since the cap
// exists to stop the decode itself from crashing.
export type ResizePlan = { scale: number; targetW: number; targetH: number } | { reject: 'pixel-cap' };

export function planResize(width: number, height: number): ResizePlan {
    if (width * height > PIXEL_CAP) return { reject: 'pixel-cap' };
    const longEdge = Math.max(width, height);
    let scale = 1;
    if (longEdge < RESIZE_MIN_LONG_EDGE_PX) scale = RESIZE_MIN_LONG_EDGE_PX / longEdge;
    else if (longEdge > RESIZE_MAX_LONG_EDGE_PX) scale = RESIZE_MAX_LONG_EDGE_PX / longEdge;
    return { scale, targetW: Math.round(width * scale), targetH: Math.round(height * scale) };
}

// ── OCR pre-pass queue order (§9 Q1, §5) ─────────────────────────────────────
// A PURE comparator over the pass's images: images a note embeds are OCR'd
// FIRST (the reference set only ORDERS the queue — membership never depends on
// another file's links, so the §2b transitive-dirtiness problem never arises),
// then most-recent-first within each group. `referenced` comes from
// metadataCache.resolvedLinks snapshotted at pass start (ordering only).
export interface OcrQueueItem { path: string; mtimeMs: number; referenced: boolean }

export function compareOcrQueue(a: OcrQueueItem, b: OcrQueueItem): number {
    if (a.referenced !== b.referenced) return a.referenced ? -1 : 1;   // referenced first
    return b.mtimeMs - a.mtimeMs;                                       // most-recent first
}
