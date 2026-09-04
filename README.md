> Seeker is a **fork** of [Obsidian-Seek](https://github.com/ryan-manor/Obsidian-Seek) by Ryan Manor.
> It is maintained by [nickolaykondratyev](https://github.com/nickolay-kondratyev) at
> [nickolay-kondratyev/Obsidian-Seeker](https://github.com/nickolay-kondratyev/Obsidian-Seeker) and,
> like the original, is released under the MIT License. See [License and Attribution](#license-and-attribution).
>
> Fork born due to being able to **add Canvas and Image OCR support** as well flag performance issues clearly (when GPU is not used)
> While there is no PR access to Seek (Ref: https://github.com/ryan-manor/Obsidian-Seek/issues/6).

# Seeker

<img width="693" height="817" alt="Screenshot 2026-06-29 at 14 33 54" src="https://github.com/user-attachments/assets/127d554d-9faf-45c0-8215-02e151c1f5c4" />


Seeker is an Obsidian native hybrid search for Obsidian vaults, built to find buried information in large and complex vaults. It combines dense semantic embeddings with lexical (keyword) search to find exactly what you're looking for, all running within Obsidian. No APIs, or local servers needed. 

Relevance has been tested and evaluated on hundreds of thousands of queries and notes, and offers easy customization to best suit your vault.

<img width="735" height="595" alt="Screenshot 2026-06-30 at 09 25 33" src="https://github.com/user-attachments/assets/ab5bf543-8d57-4f79-b912-bede11bac059" />



## Features
- Support for 52 languages (plus code)
- Inline filtering with autosuggestions
- Support for mobile with a cross device, synced index
- Indexes markdown notes, Bases (`.base`) and Canvas boards (`.canvas`) — the last two can be switched off in settings
  - Opening a Canvas result lands on the matching card when it can (long cards); otherwise the board opens as-is
- Highly tuned and evaluated for relevance on any size of Obsidian vault, even up to tens of thousands of notes. 


Seeker shares its engine with the original Seek project, so its documentation still applies: the user guide can be found [here](https://publish.obsidian.md/rmm/Seek+Documentation/About+Seek), and more information about relevance tuning and evaluation is [here](https://publish.obsidian.md/rmm/Seek+Documentation/Seek+Evaluation+%26+Development).

## Installation

1. Install the plugin in your vault.
2. In Seeker settings, click index to let Seeker scan your vault. (typically 1–3 minutes; longer for very large vaults).
3. Open search with the **Search** command and start typing.

## How It Works

Seeker embeds your notes with a local embedding model (by default the IBM Granite multilingual model, ~100 MB) and fuses those semantic scores with a lexical BM25 ranker. Indexing, embedding, and ranking all happens within Obsidian. Your notes and queries never leave your machine. 

## Image OCR (search text inside images)

Seeker can read the text in your images — screenshots, photos of whiteboards, scanned pages — so it turns up in search. It is **off by default**; turn it on under **Settings → Index (advanced) → Index text in images (OCR)**.

- **Desktop only does the work.** A desktop runs the OCR engine in the background; phones and tablets never run it. They read the extracted text a desktop already OCR'd and synced, so images become searchable everywhere without draining a phone's battery.
- **Each image is read once, then cached and synced.** The extracted text is stored one small file per image under `<your index folder>/ocr/` inside the vault, so it syncs with everything else and no image is ever OCR'd twice across your devices.
- **Formats.** `png`, `jpg`, `webp`, `gif` and `bmp` are supported. `svg` and `heic`/`heif` are skipped (the settings tab shows how many).
- **Languages.** By default Seeker picks your Obsidian language plus English. You can set an explicit list of [tesseract language codes](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html) (e.g. `eng deu fra`) in settings. Each language pack downloads once (see Network Use) and is cached like the model. Changing the languages never re-OCRs images already cached — use **Rebuild OCR cache** for that.
- **Managing the cache.** The settings tab shows how many images are cached and how much space they use. **Clear OCR cache** removes them all (and drops image results from the index); **Rebuild OCR cache** re-reads every image with the current engine and languages.

## Network Use

Seeker runs the embedding model locally, but it has to download the model and its runtime **once per device**, the first time you index a vault:

- **Model weights** are fetched from **Hugging Face** (`huggingface.co`) — the IBM Granite multilingual embedding model (~100 MB, quantized).
- **The transformers.js runtime** (the library that runs the model) is loaded from the **jsDelivr CDN** (`cdn.jsdelivr.net`).

If you enable **image OCR** (desktop only), the OCR engine and its language data are also downloaded **once per device**, and only then:

- **The tesseract.js runtime and its WebAssembly core** are loaded from the **jsDelivr CDN** (`cdn.jsdelivr.net`).
- **Language packs** (one per language, a few MB each) are fetched from the **tessdata CDN** (`tessdata.projectnaptha.com`).

These downloads happen only when the assets are not already cached. They are cached on-device afterward, so there are no repeat downloads, and Seeker works fully offline once the assets are in place. Only these model and OCR assets are ever fetched. No note content, image data, query text, or usage data is transmitted.

## WebGPU on Linux

Seeker runs the embedding model on your GPU through WebGPU when it can, and falls back to the CPU (WASM) otherwise. Search works either way, but indexing on the CPU is much slower. On Linux, Obsidian's Electron often ships with WebGPU disabled: `navigator.gpu` exists but no GPU adapter is handed out, so Seeker silently lands on the CPU even with **Compute → Force WebGPU** set. Seeker tells you when this happens: the top of its settings tab reads "Running on: CPU (WASM). WebGPU was requested but …", and a pop-up appears whenever a full reindex starts.

Verified fix (2026-09-02, Fedora Linux, AMD Ryzen AI MAX+ 395 with Radeon 8060S, Obsidian 1.13.7 Flatpak, Electron 43 / Chrome 150). Launch Obsidian with these flags:

```
--enable-features=Vulkan,VulkanFromANGLE --use-angle=vulkan --enable-unsafe-webgpu --ignore-gpu-blocklist
```

- **Flatpak**: append each flag on its own line to `~/.var/app/md.obsidian.Obsidian/config/obsidian/user-flags.conf`, then restart Obsidian.
- **AppImage / rpm / tarball**: run `obsidian <flags>`, or add the flags to the `Exec=` line of Obsidian's `.desktop` file.

Verify: open the developer console (Ctrl+Shift+I) and run `await navigator.gpu?.requestAdapter()`. It should return a non-null adapter whose `info.vendor` is not `google` (`google` is Chromium's software renderer, which Seeker rejects because it is slower than the CPU). Seeker's settings tab then shows "Running on: WebGPU — <vendor> <description>".

If it still does not work: add `--ozone-platform=x11` (Wayland issues). Add `--disable-gpu-compositing` only if you see grey video artifacts. To silence the warning instead, pick **Compute → Force CPU** in Seeker settings.

## E2E (real Obsidian)

`npm run test:e2e:obsidian` drives a REAL Obsidian (Electron) under Playwright
against a vault assembled from the committed e2e corpus, and asserts on the
search modal's rendered DOM. Linux auto-downloads a pinned Obsidian; headless
flags are defaulted when no display exists. See `docs/e2e-obsidian.md`.

```bash
npm run test:e2e:obsidian                    # whole suite
npm run test:e2e:obsidian -- search.e2e.ts   # extra args pass through to Playwright
# macOS: point at the installed app (no auto-download outside Linux)
OBSIDIAN_PATH='/Applications/Obsidian.app/Contents/MacOS/Obsidian' npm run test:e2e:obsidian
```

| Env var | Meaning |
|---|---|
| `OBSIDIAN_PATH` | Obsidian binary to drive; when unset, Linux downloads a pinned build. |
| `OBSIDIAN_VERSION` | Overrides the pinned version for the auto-download (default `1.12.7`). |
| `OBSIDIAN_E2E_EXTRA_ARGS` | Extra Chromium/Electron flags; an explicit value disables the headless auto-default. |
| `OBSIDIAN_CACHE_DIR` | Where downloaded Obsidian builds are cached (default `~/.cache/obsidian-e2e`). |

`npm run test:e2e` runs the retrieval gate (`docs/e2e-retrieval.md`) and then this suite.

## Privacy and Local Logging

Seeker writes diagnostic logs (indexing progress, search activity, and errors) to local files inside your vault to help debug performance and relevance. These logs stay on your device and are never transmitted anywhere. Additionaly, diagnostics for search and relevance can be generated which creates a report of your recent searches, with note titles, and metadata included. Results content is not included in these reports, and the reports are written to Seeker's local plugin folder. 

Seeker transmits no logging or data to me about your index, or your queries. 


## License and Attribution

Seeker is a fork of [Obsidian-Seek](https://github.com/ryan-manor/Obsidian-Seek) by Ryan Manor, and is released under the MIT License (see [`LICENSE`](./LICENSE)). The original copyright notice is retained alongside the fork's.

It builds on:

- [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) — on-device model inference.
- [IBM Granite embedding models](https://huggingface.co/ibm-granite) (Apache-2.0) — the embedding model.
- [MiniSearch](https://github.com/lucaong/minisearch) (MIT) — lexical (BM25) search.
- [tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0) — on-device image OCR (optional, desktop only).

Third-party **test data** committed under `e2e/datasets/*/` is NOT under this repo's MIT license; see each folder's `LICENSE-DATA.md` for its terms (e.g. BEIR CQADupstack-android content is CC BY-SA 4.0).
