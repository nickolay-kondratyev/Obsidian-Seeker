---
closed_iso: 2026-09-02T19:33:46Z
session_ids: [{"a": "claude", "type": "execution", "id": "65c136b1-6e80-4f36-893d-a12484e13063"}, {"a": "claude", "type": "review", "id": "81b508bd-8599-4f2f-a6d3-705231deb49f"}]
working_dir: nickolay-kondratyev_Obsidian-Seeker
id: nid_8zj5nd1vp4zcng1gwqb3uva7y_e
title: "rename any plugin names to obsidian seeker such that it would be ready to publish under its own name"
status: closed
deps: []
links: [nid_4emudvmyp2vaz9fug618fsmve_e]
created_iso: 2026-09-02T19:19:33Z
status_updated_iso: 2026-09-02T19:33:46Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

This is a fork from https://github.com/ryan-manor/Obsidian-Seek

Right now let's rename any references to Obsidian-Seek and https://github.com/ryan-manor/Obsidian-Seek to reference Obsidian-Seeker and https://github.com/nickolay-kondratyev/Obsidian-Seeker as well as update the readme to state that this is a fork from 'https://github.com/ryan-manor/Obsidian-Seek'. 

The author from now on should be renamed as well to be nickolaykondratyev. The MIT license should remain for now and we should not hide that its a fork.

---

## Resolution (done)

Renamed the plugin's **public identity** from "Seek" to "Seeker" everywhere a user or reader sees
it, updated the author/repo, and made the fork explicit — while keeping MIT and preserving the
original author's attribution.

### Metadata / packaging
- `manifest.json`: `name` "Seek"→"Seeker", `author` "Ryan Manor"→"nickolaykondratyev",
  `authorUrl` →`https://github.com/nickolay-kondratyev`. (`id` intentionally kept "seek" — see below.)
- `package.json` + `package-lock.json`: `name` "seek"→"seeker", `author`→"nickolaykondratyev".
- `LICENSE`: kept MIT; retained `Copyright (c) 2026 Ryan Manor (original Obsidian-Seek)` and added
  `Copyright (c) 2026 nickolaykondratyev (Obsidian-Seeker fork)`. MIT requires the original notice
  be preserved, and this keeps the fork honest.
- `esbuild.config.mjs`: build-log banner "Seek:"→"Seeker:".

### Docs
- `README.md`: title →"# Seeker"; added a prominent fork blockquote at the top linking upstream
  `https://github.com/ryan-manor/Obsidian-Seek` (Ryan Manor) and this fork
  `https://github.com/nickolay-kondratyev/Obsidian-Seeker`; renamed product prose "Seek"→"Seeker";
  License/Attribution section states it is a fork and that both copyright notices are retained.
  (Docs links still point to the upstream published guide — the fork ships no docs of its own yet.)
- `CHANGELOG.md`: intro line notes Seeker is a fork of Obsidian-Seek and that entries below 1.1.3
  predate the fork. Historical entries left as-is (they document upstream releases — that IS the fork history).
- `.github/workflows/release.yml`: attestation-verify comment repo →`nickolay-kondratyev/Obsidian-Seeker`.

### In-app user-facing strings (src/)
Renamed the brand "Seek"→"Seeker" in every string a user actually sees: all `new Notice(...)`
toasts, CLI/command descriptions and error output, the diagnostic report title
(`# Seeker Diagnostic Report`), the index-size report header, settings descriptions, and the About
footer (`by nickolaykondratyev`, name `Seeker`, GitHub link →this fork). Files touched: `main.ts`,
`settings-tab.ts`, `search-modal.ts`, `logger.ts`, `index-notice.ts`, `index-size.ts`,
`index-store.ts` (dev console.warn), `search.ts`.

The About footer's **X/Twitter link was removed** — it pointed to the original author's personal
`@tooape` handle; under "by nickolaykondratyev" that would misattribute a personal account, and no
replacement handle exists. Its now-dead constants (`X_URL`, `X_LOGO_PATH`) and the `brandLink()`
helper were removed with it. GitHub link →this fork; Docs link kept (real upstream docs).

### Deliberately NOT changed (and why)
The technical plugin **`id` stays "seek"**. That id is not just metadata — it is the plugin folder
name (`.obsidian/plugins/seek/`), the `obsidian://seek` deep-link scheme, the settings-tab id
(`openTabById('seek')`), the IndexedDB prefix, several localStorage keys (`seek-forensics:`,
`seek:warmup-fingerprint`), logger paths, the `seek-*` CSS namespace, and the vault-root
`Seek Index/` folder literal. Renaming it is a cross-cutting, breaking change (loses existing
installs' data, breaks saved deep-links) with **no user-visible branding benefit** since the display
name already reads "Seeker". Command-palette entries automatically show "Seeker: …" from the manifest
`name`. The `Seek Index/` folder literal and the `seek:*` command ids were kept for the same
compatibility reason.

Whether to do a full internal `seek`→`seeker` id migration before the first public release is
tracked (needs human) in **[nid_4emudvmyp2vaz9fug618fsmve_e]**.

### Verification
`npm run typecheck` ✅, `npm run build` ✅, `npm test` ✅ (1167 passed / 1 skipped). No test asserted
on the renamed literals (message-checking tests reference the exported constants, whose text was
updated in place).

