# Seeker

**Find anything in your vault — even when you don't remember the exact words.**

Seeker is hybrid search for Obsidian. It combines meaning-based (semantic) search with classic keyword search, so it finds buried notes in large, messy vaults. Everything runs inside Obsidian on your device: no API keys, no servers, and your notes never leave your machine.

![Seeker search with the result map](https://raw.githubusercontent.com/nickolay-kondratyev/Obsidian-Seeker/main/docs/images/search-result-map.png)

## Features

- **Hybrid search** — semantic + keyword ranking, tuned and evaluated for relevance on vaults of tens of thousands of notes.
- **Result map** (desktop) — your results drawn as a map beside the list: nearer the centre means more relevant, same colour means the notes are alike. See [below](#result-map).
- **Similar notes** panel — the notes most like the one you are reading, as a map plus a ranked list. See [below](#similar-notes).
- **Inline filters** with autosuggestions — narrow by tag, folder, property or date right in the search box. See [below](#filters).
- **52 languages** (plus code).
- **Notes, Bases and Canvas** — indexes markdown notes, Bases (`.base`) and Canvas boards (`.canvas`). Opening a Canvas result jumps to the matching card when it can.
- **Text inside images** (OCR) — screenshots, whiteboard photos and scanned pages become searchable. See [below](#image-ocr).
- **Folder and file names count** — `tom links kindle` finds `person/Tom/links/send-to-kindle.md`.
- **Mobile support** with an index that syncs across your devices.

## Getting started

1. Install the Seeker plugin in your vault and enable it.
2. In Seeker's settings, click **Build index**. Seeker scans your vault (typically 1–3 minutes; longer for very large vaults).
3. Run the **Search** command and start typing.

The first index downloads the embedding model once per device (see [Network use](#network-use)).

## Commands

| Command | What it does |
|---|---|
| **Search** | Search the whole vault. |
| **Search in current folder** | Search only the active note's folder and its subfolders. Opens search pre-filled with an editable `path:"Folder/*"` filter; delete it to search the whole vault again. |
| **Open similar notes** | Open the Similar notes panel in the right sidebar. Running it again brings the panel forward. |

Inside the search window:

| Key | Action |
|---|---|
| `↑` `↓` | Move through results |
| `Enter` | Open the result |
| `Cmd/Ctrl + Enter` | Open in a new tab (configurable in settings) |
| `Tab` | Accept the autosuggestion |
| `Shift + Enter` | Insert a link to the result into the current note |
| **copy link** (footer) | Copy a shareable `obsidian://` link that reopens this search |
| `Esc` | Close |

With the mouse: click opens, `Cmd/Ctrl`-click opens in a new tab, `Shift`-click inserts a link.

## Result map

On desktop, the search window shows your results as a map next to the list:

- **Nearer the centre = more relevant** to your query.
- **Same colour = alike** — notes that cover the same topic are grouped by colour.
- **Grey = not grouped** — a result unlike the others.
- Lines connect notes that are similar to each other. Moving through the list highlights the matching node, and clicking a node opens it.

The map shows when the Obsidian window is wide enough. Drag the divider to resize it, or use the tuning icon in the map's corner to adjust grouping and layout live. Turn it off under **Settings → Display → Show result map**.

## Similar notes

![Similar notes panel](https://raw.githubusercontent.com/nickolay-kondratyev/Obsidian-Seeker/main/docs/images/similar-notes.png)

Run **Open similar notes** to open a side panel that follows the note you are reading and shows the notes most like it — as a map (desktop) and a ranked list. Click any note to open it.

- **Instant** — it reuses the index Seeker already built; no extra model work.
- **Two ways to compare** (tuning icon): **Best matching section** (default) finds notes that share a strong section with yours; **Whole note average** compares the notes as a whole.
- Its map settings are separate from the search result map.
- **Map only** — drag the line between the map and the list to resize them; drag it to the bottom (or untick **Show note list** under the tuning icon) to hide the list. Double-click the line to reset.
- It only does work while the panel is visible.

## Filters

Type these in the search box alongside your words. Autosuggestions help you complete them.

| Filter | Example | Meaning |
|---|---|---|
| Tag | `#project`, `#area/work` | Notes with the tag (nested tags included) |
| Folder | `path:"Work/*"` | Notes under a folder |
| Property | `[status:draft]`, `[status:"done"]` | Frontmatter contains / exactly equals the value |
| Number property | `[rating>3]` | Numeric comparison on a number property |
| Date | `after:2026-01-01`, `before:2026-06-30` | By the note's date (when the recency bonus is on) |
| Exclude | `-draft` | Leave out notes containing the word |

## Image OCR

Seeker can read the text in your images so it turns up in search. It is **on by default**; toggle it under **Settings → Index (advanced) → Index text in images (OCR)**.

- **Only desktops do the work.** A desktop reads images in the background; phones and tablets never do. They use the text a desktop already extracted and synced, so images become searchable everywhere without draining a phone's battery.
- **Each image is read once.** The text is cached as one small file per image under `<your index folder>/ocr/` inside the vault, so it syncs with everything else and no image is read twice across your devices.
- **Formats:** `png`, `jpg`, `webp`, `gif` and `bmp`. `svg` and `heic`/`heif` are skipped (the settings tab shows how many).
- **Languages:** by default your Obsidian language plus English. You can set an explicit list of [tesseract language codes](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html) (e.g. `eng deu fra`) in settings. Changing languages does not re-read cached images — use **Rebuild OCR cache** for that.
- **Managing the cache:** the settings tab shows how many images are cached and how much space they use. **Clear OCR cache** removes them all; **Rebuild OCR cache** re-reads every image.

## How it works

Seeker embeds your notes with a local embedding model (by default the IBM Granite multilingual model, ~100 MB) and blends those semantic scores with a keyword (BM25) ranker. Each note's folder path and file name are part of what the model reads, so where a note lives counts toward matches (moving a note re-embeds it). Indexing, embedding and ranking all happen inside Obsidian.

The original Seek documentation also applies to Seeker: the [user guide](https://publish.obsidian.md/rmm/Seek+Documentation/About+Seek) and [relevance tuning and evaluation](https://publish.obsidian.md/rmm/Seek+Documentation/Seek+Evaluation+%26+Development).

## Performance: use your GPU

Seeker indexes on your GPU (WebGPU) when it can and falls back to the CPU otherwise. Search works either way, but indexing on the CPU is much slower. If Seeker is on the CPU, the top of its settings tab says so and a pop-up appears when a full reindex starts.

### WebGPU on Linux

Obsidian on Linux often ships with WebGPU disabled. The fix is a few launch flags — see the step-by-step guide: [WebGPU on Linux](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/README_WEBGPU_LINUX.md).

## Network use

Seeker runs the embedding model locally, but downloads the model and its runtime **once per device**, the first time you index a vault:

- **Model weights** from **Hugging Face** (`huggingface.co`) — the IBM Granite multilingual embedding model (~100 MB, quantized).
- **The transformers.js runtime** (the library that runs the model) from the **jsDelivr CDN** (`cdn.jsdelivr.net`).

With **image OCR** on (desktop only), the OCR engine and language data are also downloaded **once per device**:

- **The tesseract.js runtime and its WebAssembly core** from the **jsDelivr CDN** (`cdn.jsdelivr.net`).
- **Language packs** (one per language, a few MB each) from the **tessdata CDN** (`tessdata.projectnaptha.com`).

These assets are cached on-device afterward, so there are no repeat downloads and Seeker works fully offline once they are in place. Only these assets are ever fetched. No note content, image data, query text, or usage data is transmitted.

## Privacy and local logging

Seeker writes diagnostic logs (indexing progress, search activity, and errors) to local files inside your vault to help debug performance and relevance. These logs stay on your device and are never transmitted. You can also generate a search and relevance diagnostics report of your recent searches, with note titles and metadata (no note content); it is written to Seeker's local plugin folder.

Seeker sends no logs or data about your index or your queries to anyone.

## For developers

Building, testing and releasing: see [README_DEVELOPERS.md](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/README_DEVELOPERS.md).

## License and attribution

Seeker is a fork of [Obsidian-Seek](https://github.com/ryan-manor/Obsidian-Seek) by Ryan Manor, maintained by [nickolaykondratyev](https://github.com/nickolay-kondratyev) at [nickolay-kondratyev/Obsidian-Seeker](https://github.com/nickolay-kondratyev/Obsidian-Seeker). The fork was started to add Canvas and image OCR support and to flag clearly when indexing is not using the GPU, since the original does not take outside contributions ([context](https://github.com/ryan-manor/Obsidian-Seek/issues/6)).

Like the original, Seeker is released under the MIT License (see [LICENSE](https://github.com/nickolay-kondratyev/Obsidian-Seeker/blob/main/LICENSE)). The original copyright notice is retained alongside the fork's.

It builds on:

- [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) — on-device model inference.
- [IBM Granite embedding models](https://huggingface.co/ibm-granite) (Apache-2.0) — the embedding model.
- [MiniSearch](https://github.com/lucaong/minisearch) (MIT) — keyword (BM25) search.
- [tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0) — on-device image OCR (desktop only).
