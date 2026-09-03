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

Add the real-Obsidian (Electron) Playwright e2e harness and the basic search suite, wired as `npm run test:e2e:obsidian`. Read the plan ticket this depends on FIRST; it holds the ratified decisions. Then read `${MY_DEEP_MEM}/obsidian-how-to-setup-e2e-test.md` (= `/Users/nkondrat/vintrin-env/config/claude/ai_input/deep/obsidian-how-to-setup-e2e-test.md`) and follow its 12 mechanics exactly; do NOT simplify them away. Reference files to copy and adapt: `~/.claude/skills/obsidian-add-e2e/references/` (the `obsidian-add-e2e` skill can be invoked too).

## Files to add
- `scripts/setup-obsidian-bin.sh` — from the reference; pin `OBSIDIAN_VERSION` default `1.12.7`; cache under `${OBSIDIAN_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/obsidian-e2e}`; binary path on stdout, logs on stderr; non-Linux -> error telling the caller to set `OBSIDIAN_PATH`.
- `scripts/run-e2e-obsidian.sh` — the `test:e2e:obsidian` entry: `set -euo pipefail`; cd repo root; `OBSIDIAN_PATH` from setup script if unset; headless `OBSIDIAN_E2E_EXTRA_ARGS="--ozone-platform=headless --disable-gpu"` when neither `$DISPLAY` nor `$WAYLAND_DISPLAY` is set (echo `run-e2e: no display detected` to stderr); `npm run build > .tmp/e2e-build.log 2>&1`; `exec npx playwright test --config e2e/playwright.config.ts "$@"`.
- `e2e/obsidianHarness.ts` — from the reference. Adaptations for this repo:
  - Vault assembly (replaces the `.dev-vault` copy): build `.tmp/e2e/vault` fresh each run: `rm -rf`, copy `e2e/datasets/cqadupstack-android/corpus/*.md` into the vault root, write `.obsidian/app.json` `{}`, `appearance.json` `{}`, `community-plugins.json` `["seeker"]`, copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/seeker/`. No `data.json`.
  - PERSISTENT `--user-data-dir=.tmp/e2e/userdata` (NOT throwaway): this is where Chromium caches the ~100 MB model + transformers.js from the CDN; deleting it re-downloads every run. Re-write `obsidian.json` (vault entry `open: true`, `updateDisabled: true`, fixed 16-hex vault id) and `<userdata>/<vaultId>.json` `{width:1280,height:800,zoom:0}` on EVERY launch. WHY comment both.
  - Plugin id read from `manifest.json`. After `layoutReady`: `Escape`, `app.plugins.setEnable(true)`, `app.plugins.enablePlugin('seeker')`.
  - Helpers: `runCommand(id)`, `page`, `close()` that kills and WAITS for process exit.
  - Mechanic 11: never import from `src/` — everything there transitively imports `obsidian`. Duplicate the few CSS class names with a WHY comment.
- `e2e/playwright.config.ts` — reference verbatim: `testMatch: '**/*.e2e.ts'`, `workers: 1`, `fullyParallel: false`, `timeout: 120_000`, `expect.timeout: 15_000`, `outputDir: '.tmp/e2e/test-results'`. The reindex test needs a longer per-test timeout (`test.setTimeout(10 * 60_000)`) because the first run downloads the model.
- `e2e/tsconfig.json` — mirrors root, `types: ["node"]`. Root `tsconfig.json` already includes `e2e/**/*.ts`, so `npm run typecheck` must stay green with `@playwright/test` installed.
- `e2e/search.e2e.ts` — serial; ONE launch in `beforeAll`, `close()` in `afterAll`. Tests, in order:
  a. `seeker:search` via `app.commands.executeCommandById` opens the modal: `.seeker-modal` visible, `.seeker-edit` is `document.activeElement`.
  b. Before any index: type a query, expect `.seeker-noindex` (text "Your vault isn’t indexed yet" — note the curly apostrophe in `src/search-modal.ts` line ~800). Close the modal with Escape.
  c. `await app.plugins.plugins.seeker.runFullReindex({ skipConfirm: true })` inside `page.evaluate` resolves `true`. Then assert the file count: the Notice text is `Seeker reindex: ✅ <n> files …` (`src/main.ts` ~line 2050) — simplest is to capture `onProgress` messages or read the final Notice; assert n == number of corpus files.
  d. For each entry of `e2e/datasets/cqadupstack-android/curated-queries.json` (read with `fs` in the spec): open the modal, type `text` into `.seeker-edit` with `page.keyboard.type`, wait for `.seeker-result` rows, collect `.seeker-result-title` texts, expect the title of `corpus/<expectDocId>.md` (first line minus leading `# `) at index < `maxRank`. Failure message must print the query, expected title and the actual top 5. Escape closes the modal between queries.
  e. Open the modal with the first keyword query (`kw-zipalign`), press Enter on the top result, expect `app.workspace.getActiveFile()?.path` to be `29843.md`.
- `package.json`: devDependency `@playwright/test` at the same version line as the installed `playwright-core` (1.62.1); scripts `"setup:obsidian": "bash scripts/setup-obsidian-bin.sh"`, `"test:e2e:obsidian": "bash scripts/run-e2e-obsidian.sh"`. The combined `test:e2e` already exists from the previous ticket.
- `README.md`: short "E2E (real Obsidian)" section: the run commands (`npm run test:e2e:obsidian`, `npm run test:e2e:obsidian -- search.e2e.ts`, macOS `OBSIDIAN_PATH='/Applications/Obsidian.app/Contents/MacOS/Obsidian' npm run test:e2e:obsidian`) and env vars (`OBSIDIAN_PATH`, `OBSIDIAN_VERSION`, `OBSIDIAN_E2E_EXTRA_ARGS`, `OBSIDIAN_CACHE_DIR`). Also a one-line entry in `CLAUDE.md` under Commands (SUCCINCT). Point `docs/e2e-obsidian.md` (new, short) at the deep memory for the mechanics; document the persistent `.tmp/e2e/userdata` cache and the budget.

## Environment facts (verified 2026-09-03 in the dev container)
x86_64, network to github.com and huggingface.co OK, Electron's shared libs present (libgtk-3, libnss3, libasound, libgbm, libatk-bridge, libxshmfence), no `$DISPLAY`, `/run/.containerenv` exists. Under `--disable-gpu` the plugin resolves to wasm: 150 notes index in ~30-60 s. Plugin facts: command id `seeker:search`; `runFullReindex(opts)` is public on the plugin (`src/main.ts` ~2009); the modal query field is a contenteditable `.seeker-edit` (`src/query-field.ts`); results are `.seeker-result` / `.seeker-result-title` (`src/search-modal.ts` ~1015).

## Acceptance
- `npm run test:e2e:obsidian` passes in the container (headless line printed) — run it twice; the second run must not re-download the model (check timing / stderr).
- `npm run typecheck`, `npm test` green. `npm test` must NOT pick up `*.e2e.ts` (vitest include is `*.test.ts`).
- Report the measured warm wall-clock in `docs/e2e-obsidian.md`.
- If a test cannot pass, do not weaken it: reopen with what failed.
- Record with `change_log`.

