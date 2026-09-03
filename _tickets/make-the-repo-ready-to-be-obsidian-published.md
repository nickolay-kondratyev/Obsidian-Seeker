---
id: nid_4qv8zdtdmhvc3uugdupcgrccg_e
title: "Make the repo ready to be obsidian published"
status: open
deps: []
links: []
created_iso: 2026-09-03T17:19:04Z
status_updated_iso: 2026-09-03T17:19:04Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

Make the repo ready to be published with Obsidian.

Find the best practices and have './release.sh' script.

I am thinking that we will want to trigger asset creation on github workflow whenever there is a tag added and `./release.sh` would be responsible for:
- Running tests to make sure basics are in place.
- Revving the patch version
- Committing
- Adding the tag with for new version.