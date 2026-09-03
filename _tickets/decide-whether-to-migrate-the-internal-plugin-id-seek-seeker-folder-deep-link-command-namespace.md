---
id: nid_4emudvmyp2vaz9fug618fsmve_e
title: "Decide whether to migrate the internal plugin id 'seek' -> 'seeker' (folder, deep-link, command namespace)"
status: open
deps: []
links: [nid_8zj5nd1vp4zcng1gwqb3uva7y_e]
created_iso: 2026-09-02T19:32:33Z
status_updated_iso: 2026-09-02T19:32:33Z
type: task
priority: 3
assignee: CC_WITH-nickolaykondratyev
tags: [decide, need-human]
---

Follow-up from [nid_8zj5nd1vp4zcng1gwqb3uva7y_e] (rename to Obsidian-Seeker for publishing).

During that rename the DISPLAY name was changed to "Seeker" everywhere users see it (manifest `name`, README, CHANGELOG, all `new Notice(...)` toasts, CLI/command descriptions, diagnostic report titles, settings copy, About footer). The MIT license keeps the original Ryan Manor copyright plus a new nickolaykondratyev line, and README/LICENSE state it is a fork of https://github.com/ryan-manor/Obsidian-Seek.

DELIBERATELY LEFT UNCHANGED: the technical plugin `id` in manifest.json is still "seek". That id is not just metadata — it is woven through the codebase as a stable identifier:
  - plugin folder: `.obsidian/plugins/seek/...` (Obsidian derives it from manifest.id)
  - deep-link protocol handler: `registerObsidianProtocolHandler('seek', ...)` in src/main.ts (~line 609) and every `obsidian://seek?...` link built in src/search-modal.ts
  - settings tab id: `openTabById('seek')` in src/search-modal.ts (~line 799)
  - IndexedDB prefix via `indexDbPrefix(this.manifest.id)` (src/index-store.ts)
  - localStorage keys: `seek-forensics:` (src/forensics.ts), `seek:warmup-fingerprint:v1` (src/embedder.ts), recents/reconcile-sig keys
  - logger paths `.obsidian/plugins/seek/logs/seek-log-*` (src/logger.ts)
  - vault-root visible index folder literal `Seek Index/` (src/types.ts, src/main.ts)
  - the `seek-` CSS class namespace in styles.css + all TS that references those classes

WHY LEFT AS-IS (Pareto + do-no-harm): a full id rename is a cross-cutting change that (a) changes the plugin folder so existing installs lose their index/settings, (b) changes the deep-link scheme so any saved `obsidian://seek` links break, and (c) must be done atomically across manifest.id, the hardcoded 'seek' protocol/tab strings, storage keys, and the CSS namespace or the plugin breaks. It delivers no user-visible branding value (the display name already reads "Seeker"). For the Obsidian community registry the id is a stable technical handle and legitimately may differ from the display name.

DECISION NEEDED FROM HUMAN: For the first public release of Obsidian-Seeker, is keeping the technical id "seek" acceptable, or do you want a full migration to "seeker"? If publishing to the Obsidian community plugins list, confirm the id you want registered (community guidance: lowercase, no "obsidian" prefix; "seek" may collide if the upstream ever registers it, "seeker" avoids that). If you want the migration, this ticket becomes the implementation ticket for the atomic rename above.

RECOMMENDATION: keep id "seek" for now (already done) UNLESS you plan to submit to the community list alongside the upstream, in which case migrate to "seeker" as a clean, one-time change before the first release (no existing users to break yet).

--------------------------------------------------------------------------------

Yes I plan to submit the plugin, so I am thinking we will want to add some scripts that would wholesale rename the 'seek' to 'seeker'