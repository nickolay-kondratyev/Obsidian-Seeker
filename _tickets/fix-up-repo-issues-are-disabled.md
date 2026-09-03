---
id: nid_2paz9tdqruzhxqm65mdhllo3w_e
title: fix up repo issues are disabled
status: open
deps: []
links: []
created_iso: '2026-09-03T20:22:09Z'
status_updated_iso: 2026-09-03T20:23:47Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: [need-human]
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-2
---
```
Warning
Repository issues are disabled
nickolay-kondratyev/Obsidian-Seeker
```

how to fix this.

## Resolution

This is a GitHub repository *setting*, not a code change — the repo has the
Issues feature toggled off. Fixing it requires GitHub admin auth, which is not
available in the agent environment (`gh` is not logged in, no `GH_TOKEN`).

**Fix (repo owner/admin, via web UI):**
1. Go to https://github.com/nickolay-kondratyev/Obsidian-Seeker/settings
2. Under **Features**, check the **Issues** box.

**Fix (via CLI, once authenticated):**
```bash
gh auth login   # one-time
gh api -X PATCH repos/nickolay-kondratyev/Obsidian-Seeker -f has_issues=true
```

Blocked on human/admin action — tagged `need-human`.
