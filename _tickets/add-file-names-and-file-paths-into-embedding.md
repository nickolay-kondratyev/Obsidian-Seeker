---
closed_iso: 2026-10-20T18:05:33Z
id: nid_taexabol48s18drqbg0ikk9pl_e
title: add file names and file paths (from vault) into embeddings
status: closed
deps: []
links: []
created_iso: '2026-10-20T17:22:15Z'
status_updated_iso: 2026-10-20T18:05:33Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker
---
Right now the embedding does not take into account file and file path (from the vault into the embedding search).

I would like the file path (from the vault, not absolute path) to be taken into account when performing embedding search,
its ok that it will require a re-index.

With this we will also want to adjust the readme to state this.

## Resolution (2026-10-20)

**Done.** The dense (embedding) input now includes each file's vault-relative path. The absolute disk path is never used.

- **What was already there:** the file NAME already led every chunk's title (note/canvas/base basename, image name). Only the FOLDER was missing.
- **Change:** `src/token-budget.ts` `embedInput` now composes `docPrefix + [folder\n] + title\n\n + content [+ \n\n denseSuffix]`, e.g. `Projects/Work\nMeeting > Agenda\n\n…`. Vault-root files get no folder line. A private `embedHead` is shared with `splitChunk`'s overhead and recount, so split parts carry the line and stay within the 512-token budget.
- **Re-index:** `CHUNKER_VERSION` 10 → 11 (`src/chunker.ts`); this also folds in the three pending id-affecting fixes documented there. chunk_ids are unchanged (the folder derives from note_path, which `chunkIdFor` already hashes). On this branch a stale index is consent-gated: a banner asks the user to reindex once, unless a synced device's v11 sidecar heals it without re-embedding. Moving a note to another folder now re-embeds it (F13 carry-over misses by design).
- **Sidecar safety (found in review):** because ids are unchanged, old folder-less vectors could have been handed to peers by id. Fixed in `src/search.ts` `runSidecarFlush`:
  - a delta on a version-stale local index no longer publishes (`SidecarFlushJob.indexAtLiveIdentity`), so it can't create a partial "current" producer that `rebuildFromSidecar` would nuke an index down to;
  - a current index whose own sidecar is from an older build clears it before stamping.
  - Tests are in `src/offmutex-flush.test.ts`.
- **Docs:** README (Features + How It Works), CHANGELOG (Unreleased), stale comments in bm25.ts/types.ts/index-store.ts/search.ts/dense-clean.ts/chunker.ts.
- **Verification:** `npm run typecheck` ✓; `npm run test` 1625 passed / 19 skipped; `npm run test:e2e:retrieval` ✓ (nDCG@10 0.899 = pinned baseline; corpus is flat, so it does not exercise folders); `npm run test:e2e:obsidian` 17/17 ✓. Three fresh-reviewer passes; the final one returned ready as-is.
- **Follow-ups:** nid_5g7vfrbjxmxxalkwl4zfg03f9_e (measure the folder line on a foldered eval, updated); nid_bn1mmy0av706371brezkpnxnh_e (rebuildFromSidecar has no coverage check, pre-existing).
