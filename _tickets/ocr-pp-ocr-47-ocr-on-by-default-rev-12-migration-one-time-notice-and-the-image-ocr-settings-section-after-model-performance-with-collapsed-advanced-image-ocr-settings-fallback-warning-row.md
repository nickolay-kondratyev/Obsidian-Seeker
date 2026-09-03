---
id: nid_54wu4qecgbvwswm5ty6uuq0z9_e
title: "OCR PP-OCR 4/7: OCR on by default (rev-12 migration + one-time notice) and the 'Image OCR' settings section after 'Model & performance' with collapsed 'Advanced image OCR settings' + fallback warning row"
status: open
deps: [nid_v9z9mlhqtm2dek4a83y28no57_e]
links: [nid_6xykw7uso5943i7xvh53i2g2p_e, nid_4y2zlnfyt57qocu762lxdoiie_e, nid_bj4oo8zwshwaw8v3efwa4nnim_e, nid_v9z9mlhqtm2dek4a83y28no57_e, nid_09e6lv2lomzby3abne4r8sedu_e, nid_jz9fvvhltomq9o9nmesc57zjb_e, nid_w2rhmbpwd634wv55m1top0n4g_e, nid_24y96qrb1q8ndmdttvwkfb653_e, nid_ybv5cljnxx9wb4ha2gbvpsbmd_e]
created_iso: 2026-09-03T23:19:32Z
status_updated_iso: 2026-09-03T23:19:32Z
type: feature
priority: 2
assignee: CC_WITH-nickolaykondratyev
tags: [ocr, ui]
---

READ FIRST: the plan ticket (search `_tickets/` for "PLAN: PP-OCRv6-tiny default OCR engine") — D5, D6, D7. Then `src/types.ts` (`DEFAULT_SETTINGS` — `indexImages: false`, `ocrLangs: []`, `settingsRev: 11` — and `migrateSettings` with its rev-7 and rev-11 clauses: the pattern to copy, including the "never downgrade the stamp" tail), `src/settings-migrate.test.ts`, `src/main.ts` onload around the `migrateSettings(raw)` / `Object.assign` lines (where a one-time migration Notice can hook, gated on the ORIGINAL `raw.settingsRev`), `src/settings-tab.ts` in full: `display()` section order (`renderBackendLine`, `renderIndex`, `renderRelevance`, `renderDisplay`, `renderModel`, `renderReset`, `renderAbout`), `renderIndexAdvanced` (calls `this.renderOcr(adv)` — the block that MOVES), `renderOcr` (toggle, languages field, status/cache line, Clear two-step, Rebuild), the chevron disclosure pattern in `renderIndex` (`seeker-disclosure`, `indexAdvancedOpen` tab-instance flag), the `Notice` copy style. Also `src/main.ts` `getOcrStats`, `clearOcrCache`, `rebuildOcrCache`, `onOcrSettingsChanged`, `retryPrimaryOcrEngine` + `getOcrEngineStatus` (ticket 3), and `README.md`'s OCR paragraph (update it).

## Goal
OCR on by default with an opt-out, and OCR promoted to its own settings section placed right AFTER "Model & performance", with a collapsed "Advanced image OCR settings" disclosure. The model picker inside that disclosure is ticket 5; leave a clearly named hook (`renderOcrModel(adv)` stub is NOT wanted — just keep the disclosure's render method small so ticket 5 adds one call).

## Deliverables
1. `src/types.ts`: `indexImages: true` (update the field comment: ON by default, desktop OCRs, phones read the synced cache); `settingsRev: 12`; in `migrateSettings`: `if (fromRev < 12) raw.indexImages = true;` with a WHY comment (OCR never shipped before rev 12 — tag 1.1.10 has no OCR — so no install holds a deliberate `false`; unconditional like rev 5, not conditional like rev 7); bump the `Math.max(fromRev, 12)` tail. Tests in `src/settings-migrate.test.ts`: rev-11 install with `indexImages: false` → true; rev-12 install with `false` → stays false; missing key → true.
2. Pure helper in `src/types.ts` next to `migrateSettings`: `export function isOcrDefaultOnUpgrade(loaded: Partial<SeekerSettings> | null): boolean` → true ONLY for an UPGRADER: `loaded !== null` (a fresh install — `loadData()` returned null — must NOT see the notice; nothing "changed" for them) AND `(loaded.settingsRev ?? 1) < 12`. Call it in `src/main.ts` onload on the value `loadData()` returned, BEFORE `migrateSettings(raw)` overwrites `settingsRev` (same ordering trap the existing `migrateSidecarPath` flag documents there). If true and `!isMobilePlatform()`, show ONE `Notice` (≈8 s): "Seeker now indexes text in your images (OCR). Turn it off under Settings → Image OCR." Not on mobile (nothing changes there beyond reading the cache). Unit-test the helper in `src/settings-migrate.test.ts`: null → false; `{}` (pre-rev-1 data.json) → true; rev 11 → true; rev 12 → false.
3. `src/settings-tab.ts`:
   - Remove `this.renderOcr(adv)` from `renderIndexAdvanced`. Add `renderImageOcr(containerEl)` called in `display()` immediately after `this.renderModel(containerEl)` and before `renderReset` (D7 — the human wants Model & performance first, Image OCR second). Heading: `new Setting(containerEl).setName('Image OCR').setHeading()`.
   - Section body, top to bottom: (a) the toggle (copy: "Index text in images. Images are OCR'd on desktop; phones and tablets search the synced results." + the existing 'takes effect on next catch-up' sentence); (b) status line reusing the existing cache-count/MB + skipped svg/heic + live-progress rendering; (c) fallback warning row ONLY when `getOcrEngineStatus().fallbackReason` is non-null: name "Fast OCR engine unavailable on this device", desc = the reason + "Images are being read with the Tesseract fallback (slower, per-language).", button "Retry fast engine" → `plugin.retryPrimaryOcrEngine()` then rerender; (d) Clear OCR cache (always, two-step, count + MB) and Rebuild OCR cache (only while ON) — unchanged behaviour, moved; (e) the disclosure: `seeker-disclosure` chevron labelled "Advanced image OCR settings", flag `ocrAdvancedOpen` initialised `false` on every tab instance (NOT persisted — the human wants it collapsed on every open), rendering `renderImageOcrAdvanced(adv)`.
   - `renderImageOcrAdvanced(adv)`: the existing languages text field, renamed "Fallback OCR languages (Tesseract)", desc rewritten: "Only used when the fast engine is unavailable on this device. Space-separated Tesseract codes (e.g. "eng deu fra"); blank = your Obsidian language plus English. Changing this never re-OCRs cached images." Keep its onChange/blur wiring. Ticket 5 adds the model picker ABOVE it.
   - CSS: reuse `seeker-adv` / `seeker-disclosure`; add nothing new unless the warning row needs a `seeker-warn` tint (check `styles.css` for an existing warning class first).
4. `README.md`: OCR is on by default; how to turn it off; desktop-only note; fallback warning meaning.

## Acceptance
- `npm run typecheck`, `npm run test`, `npm run build` green; migration tests added.
- Manual in a dev vault (record in the resolution): fresh `data.json` → OCR on, section appears after Model & performance, disclosure collapsed on each open; a rev-11 `data.json` with `indexImages:false` → one Notice, OCR on.

