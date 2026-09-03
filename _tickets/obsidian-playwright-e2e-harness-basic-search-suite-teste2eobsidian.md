---
id: nid_yz7qu6wa2w5u2mu6soip6jl1x_e
title: "Obsidian Playwright e2e harness + basic search suite (test:e2e:obsidian)"
status: open
deps: [nid_t5n3efu9vt5yk1drwg27q2uog_e, nid_q5flwbl6fzfu1eu69tyful8yg_e]
links: []
created_iso: 2026-09-03T20:40:09Z
status_updated_iso: 2026-09-03T20:40:09Z
type: feature
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [e2e]
---

Add the real-Obsidian (Electron) Playwright e2e harness and the basic search suite, wired as `npm run test:e2e:obsidian`.

## Read first (in this order)
1. The plan ticket this depends on: `_tickets/plan-real-obsidian-playwright-e2e-suite-basic-search.md` (nid_t5n3efu9vt5yk1drwg27q2uog_e). It holds the ratified decisions; this ticket implements its "Basic test list" a–e.
2. `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md` (= `/Users/nkondrat/vintrin-env/config/claude/ai_input/deep/obsidian-how-to-setup-e2e-test.md`): the 12 non-negotiable mechanics. Do NOT simplify them away.
3. Reference files to copy and adapt: `~/.claude/skills/obsidian-add-e2e/references/` (`setup-obsidian-bin.sh`, `run-e2e.sh`, `obsidianHarness.ts`, `playwright.config.ts`, `example.e2e.ts`, `tsconfig.e2e.json`). Every deviation from the references is listed explicitly below; everything else is copied as-is.

## Verified facts (2026-09-03) — write the spec against THESE, not against assumptions
- Plugin id `seeker` (`manifest.json`); command id `seeker:search` (`src/main.ts` ~584); plugin instance = `app.plugins.plugins.seeker`.
- `runFullReindex(opts?: { skipConfirm?: boolean; onProgress?: (msg: string) => void }): Promise<boolean>` is public on the plugin (`src/main.ts` ~2009). It resolves `true` whenever a pass RAN — even if the pass FAILED (the ✅/❌ verdict lives only in a Notice). The reliable completion signal is the LAST `onProgress` message, format `Indexed <files> files · <chunks> chunks` (`src/search.ts` ~1343).
- `plugin.orchestrator.indexedChunkCount(): Promise<number | null>` (`src/search.ts` ~2659). `orchestrator` is TS-`private` on the plugin, which is compile-time only; inside `page.evaluate` access it as `(plugin as any).orchestrator`.
- Modal DOM (`src/search-modal.ts`): root `.seeker-modal` (~351). Query field = contenteditable `.seeker-edit` (`src/query-field.ts` ~233), focused on open. Result rows `.seeker-result` (~1015) — BUT skeleton placeholder rows ALSO carry `.seeker-result` (`seeker-result seeker-skeleton`, ~866), so always select `.seeker-result:not(.seeker-skeleton)`. Result title `.seeker-result-title` (~1019): its text is the FILE BASENAME WITHOUT `.md` (`noteTitle()` ~117), NOT the note's H1. So for `expectDocId: "29843"` the expected title text is exactly `29843`. One row per note (deduped upstream, ~904); the first page is 10 rows (`PAGE_SIZE`), more than any `maxRank` (≤ 3). Search is debounced 200 ms (`DEBOUNCE_MS`); the results container carries class `is-loading` while a re-search is in flight.
- Empty-index onboarding: `checkIndexState()` runs on modal OPEN (~453) and, while the query is empty, paints `.seeker-noindex` whose `.seeker-noindex-title` text is `Your vault isn’t indexed yet` (~800, CURLY apostrophe U+2019). No typing is needed — and typing would start a search that first awaits the model load (very slow on a cold cache), so test b must NOT type.
- Enter opens the selected row (`selectedIndex` starts at 0 = top row) via `leaf.openFile` (~1362) and the modal closes itself.
- Expectations: `e2e/datasets/cqadupstack-android/curated-queries.json` = `[{ id, kind, text, expectDocId, maxRank, rationale }]`, 10 entries. Corpus = `e2e/datasets/cqadupstack-android/corpus/<docId>.md`, 150 files, flat (no folders, no frontmatter). `e2e/retrieval.e2e.test.ts` gates these same bounds with the plugin's DEFAULT settings (`harnessSettings()` = `DEFAULT_SETTINGS`, `bench/harness/page-common.ts` ~70), and a fresh vault with no `data.json` runs on defaults too, so the same `maxRank` bounds apply in the modal.
- Environment: dev container is x86_64 Linux, no `$DISPLAY`, `/run/.containerenv` exists, network to github.com + cdn.jsdelivr.net + huggingface.co OK, Electron shared libs present (libgtk-3, libnss3, libasound, libgbm, libatk-bridge, libxshmfence). Under `--disable-gpu` the plugin resolves to wasm; 150 notes index in ~30–60 s.
- `.tmp/` is gitignored; `npm run build` writes `main.js` to the repo root (gitignored). Root `tsconfig.json` `include` already lists `e2e/**/*.ts`, so `npm run typecheck` compiles the new files. vitest's default include is `*.test.*` / `*.spec.*`, so `*.e2e.ts` never enters `npm test`.
- Installed `playwright-core` is 1.62.1; `@playwright/test` must be on the same line.

## Files to add
### `scripts/setup-obsidian-bin.sh`
Copy of the reference. One change: `OBSIDIAN_VERSION="${OBSIDIAN_VERSION:-1.12.7}"` (env override is a plan decision). Keep: cache under `${OBSIDIAN_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/obsidian-e2e}`, binary path on stdout / all logs on stderr, non-Linux exits 1 telling the caller to set `OBSIDIAN_PATH`.

### `scripts/run-e2e-obsidian.sh` (the `test:e2e:obsidian` entry)
Copy of the reference `run-e2e.sh` with these changes:
- Auto-default the headless flags ONLY on Linux: condition = `uname -s` is `Linux` AND `OBSIDIAN_E2E_EXTRA_ARGS` unset AND neither `$DISPLAY` nor `$WAYLAND_DISPLAY` set. WHY: macOS has no `$DISPLAY` either, and `--ozone-platform=headless` is a Linux-only Chromium flag; the reference condition would wrongly pass it on the macOS release host (next ticket). Keep the stderr line `run-e2e: no display detected — using headless Obsidian flags: …`.
- Replace `npm run setup:dev-vault` with `mkdir -p .tmp && npm run build > .tmp/e2e-build.log 2>&1`. There is no dev vault: the harness assembles the vault (below).
- Drop the `npx tsc -p e2e/tsconfig.json` line: root `npm run typecheck` already covers `e2e/**`, and that line would fail anyway (root sets `allowImportingTsExtensions`, which requires `--noEmit`).
- Keep `exec npx playwright test --config e2e/playwright.config.ts "$@"`.

### `e2e/obsidianHarness.ts`
Copy of the reference, then:
- Vault assembly replaces `prepareVaultCopy`: `rm -rf .tmp/e2e/vault`; copy every `e2e/datasets/cqadupstack-android/corpus/*.md` into the vault root; write `.obsidian/app.json` = `{}`, `.obsidian/appearance.json` = `{}`, `.obsidian/community-plugins.json` = `["seeker"]`; copy repo-root `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/seeker/`. Throw with a "run `npm run build`" message if `main.js` is missing. Never write a `data.json` (defaults are the contract). Delete `DEV_VAULT_DIR` and the `extraFixtures` option (unused; a follow-up can add it back).
- PERSISTENT `--user-data-dir` = `.tmp/e2e/userdata` (rename `SANDBOX_CONFIG_DIR`). In `prepareSandboxConfigDir` REMOVE the `fs.rmSync` of that dir; keep `mkdirSync({ recursive: true })` and re-write BOTH `obsidian.json` (fixed 16-hex vault id, `open: true`, `updateDisabled: true`) and `<userdata>/<vaultId>.json` = `{width:1280,height:800,zoom:0}` on EVERY launch. WHY comment: this dir holds Chromium's cache of the ~100 MB model + transformers.js fetched from the CDN (`src/iframe-runner.ts`, `env.useBrowserCache`); wiping it re-downloads on every run. Stale plugin index state cannot leak because the vault copy is fresh and the suite runs an explicit full reindex (which nukes the plugin's IndexedDB).
- Keep as in the reference: CDP attach via `--remote-debugging-port=0` + stderr `DevTools listening on` parse (never `_electron.launch`), `--no-sandbox` on linux, `OBSIDIAN_E2E_EXTRA_ARGS` split, `layoutReady` → `Escape` → `app.plugins.setEnable(true)` → `enablePlugin(PLUGIN_ID)` → wait for `app.plugins.plugins[PLUGIN_ID]`, `runCommand()`, `page`, `close()` that kills AND waits for process exit. `relaunch()` and `setTheme()` may be deleted (unused).
- Mechanic 11: never import from `src/` (everything there transitively imports `obsidian`). Put the duplicated selectors/texts in ONE `const SEEKER_DOM = { modal: '.seeker-modal', edit: '.seeker-edit', noIndex: '.seeker-noindex', resultRow: '.seeker-result:not(.seeker-skeleton)', resultTitle: '.seeker-result-title', loading: '.seeker-modal .is-loading' }` in the spec, with a WHY comment pointing at `src/search-modal.ts`.

### `e2e/playwright.config.ts`
Reference verbatim except `outputDir: '../.tmp/e2e/test-results'` — Playwright resolves `outputDir` relative to the CONFIG FILE's directory (`e2e/`), which is why the reference also uses a `../` path. Keep `testDir: '.'`, `testMatch: '**/*.e2e.ts'`, `workers: 1`, `fullyParallel: false`, `retries: 0`, `timeout: 120_000`, `expect.timeout: 15_000`.

### `e2e/tsconfig.json`
The reference `tsconfig.e2e.json`, renamed, plus `"noEmit": true` (see the `allowImportingTsExtensions` note above). It serves Playwright/editors only; `npm run typecheck` (root config) is the gate.

### `e2e/search.e2e.ts`
`test.describe.configure({ mode: 'serial' })`; ONE `ObsidianHarness.launch()` in `beforeAll`, `harness.close()` in `afterAll`. At module scope read `curated-queries.json` and count `corpus/*.md` with `node:fs`. Spec-local helpers: `openModal()` = `harness.runCommand('seeker:search')` then `expect(modal).toBeVisible()`; `closeModal()` = `page.keyboard.press('Escape')` then `expect(modal).toBeHidden()`; `resultTitles()` = `page.locator(\`${SEEKER_DOM.resultRow} ${SEEKER_DOM.resultTitle}\`).allTextContents()`; `waitForResults()` = `expect.poll(async () => (await page.locator(SEEKER_DOM.loading).count()) === 0 && (await resultTitles()).length > 0, { timeout: 60_000 }).toBe(true)` then return `resultTitles()`.

Tests, in this order:
- **a. command opens the modal** — `openModal()`; `expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('seeker-edit')))` is `true`.
- **b. unindexed vault shows onboarding** — modal still open, NO typing: `expect(page.locator(SEEKER_DOM.noIndex))` is visible and contains text `Your vault isn’t indexed yet` (curly apostrophe). Then `closeModal()`.
- **c. full reindex indexes the whole corpus** — `test.setTimeout(10 * 60_000)` (the first run downloads the model). In ONE `page.evaluate`: `const msgs: string[] = []; const ran = await plugin.runFullReindex({ skipConfirm: true, onProgress: (m) => msgs.push(m) }); const chunks = await plugin.orchestrator.indexedChunkCount(); return { ran, last: msgs.at(-1) ?? null, chunks };`. Assert `ran === true`; `last` matches `/^Indexed (\d+) files · (\d+) chunks$/` and the files group equals the corpus file count (150); `chunks > 0`.
- **d. curated queries rank within bound** — a loop at module scope emits one `test(\`${q.id}: "${q.text}" ranks ${q.expectDocId} within ${q.maxRank}\`)` per entry (10 tests). Body: `openModal()`; `page.keyboard.type(q.text)`; `const titles = await waitForResults()`; `const rank = titles.indexOf(q.expectDocId)` (0-based); `expect(rank, msg).toBeGreaterThanOrEqual(0)` and `expect(rank, msg).toBeLessThan(q.maxRank)`, where `msg` includes the query text, the expected doc id and `titles.slice(0, 5)`. `closeModal()` in a `finally`.
- **e. Enter opens the top result** — `openModal()`; type the `kw-zipalign` entry's text; `waitForResults()`; `page.keyboard.press('Enter')`; `expect.poll(() => page.evaluate(() => app.workspace.getActiveFile()?.path ?? null)).toBe('29843.md')`.

### `package.json`
- devDependency `"@playwright/test": "^1.62.1"` (`npm install` updates `package-lock.json`; `npx playwright` then resolves to it).
- scripts: `"setup:obsidian": "bash scripts/setup-obsidian-bin.sh"`, `"test:e2e:obsidian": "bash scripts/run-e2e-obsidian.sh"`. The combined `test:e2e` already exists from ticket nid_q5flwbl6fzfu1eu69tyful8yg_e and becomes runnable end-to-end with this ticket.

### Docs
- `README.md`: short "E2E (real Obsidian)" section: `npm run test:e2e:obsidian`, `npm run test:e2e:obsidian -- search.e2e.ts`, macOS `OBSIDIAN_PATH='/Applications/Obsidian.app/Contents/MacOS/Obsidian' npm run test:e2e:obsidian`; env vars `OBSIDIAN_PATH`, `OBSIDIAN_VERSION`, `OBSIDIAN_E2E_EXTRA_ARGS`, `OBSIDIAN_CACHE_DIR`.
- `docs/e2e-obsidian.md` (new, short): what the suite covers (a–e), the persistent `.tmp/e2e/userdata` cache and why, the measured cold + warm wall-clock, and a pointer to the deep memory for the mechanics (do not restate them).
- `CLAUDE.md` Commands: one SUCCINCT line for `npm run test:e2e:obsidian`, and note that `test:e2e` runs both suites.

## Acceptance
- `npm run test:e2e:obsidian` passes in the dev container and prints the `run-e2e: no display detected` line. Run it TWICE and record both wall-clocks in `docs/e2e-obsidian.md`. Expected: the second run is faster because the model cache in `.tmp/e2e/userdata` is warm. If the second run still re-downloads the model (timing / Obsidian stderr), the tests still pass: document it and open a follow-up ticket instead of failing this one.
- `npm run typecheck` and `npm test` green; `npm test` must NOT pick up `e2e/search.e2e.ts`.
- `git status` shows no new artifacts outside `.tmp/` (build outputs stay gitignored).
- If a test cannot pass, do not weaken it (no widening `maxRank`, no skipping a query, no `sleep`): reopen with what failed.
- Record with `change_log`.
