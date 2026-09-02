Quick reference for keeping citations and PDFs organized in Zotero so they sync cleanly into reading notes here, without duplicate entries piling up every semester.

## Set up collections first

Create one collection per thesis chapter (`Methods`, `Transit Equity`, `Zoning History`), not one giant flat library. Subcollections for sub-arguments only if a chapter genuinely splits — otherwise the tree gets deeper than the chapter itself and finding anything again takes longer than it should.

## Tag, don't just file

Use tags for theme (`equity`, `zoning`, `methods`), never status — that's for color tags.

## Import PDFs correctly

Drag PDFs straight into the matching collection rather than the general library — Zotero auto-attaches metadata from the file when it can, and flags anything it can't match so I fix it immediately instead of finding it broken six months later, mid-citation, during a writing session when I have no patience left for cleanup.

## Use color tags for status

Three colors only: red for "unread," yellow for "skimmed," green for "notes taken." Keeps the collection view scannable at a glance.

1. Right-click the tag selector, assign a color, done.

## Link into Obsidian

Install the Zotero Integration community plugin, point its export template at `templates/lit-note.md`, and run "Add bibliography entry" from the command palette per source. This pulls title, author, and page fields straight into the new note's frontmatter automatically.

## Weekly maintenance

Fridays: check the `Unread` red-tag view, clear the duplicate-items panel, skim anything green.

## Backup

Sync to the Zotero cloud storage plan weekly, and export a full `.bib` snapshot into the vault's `refs/` folder every month as a second, offline copy. This is cheap insurance against a sync conflict or an accidental library merge eating months of careful tagging work — it happened once, early on, in my second semester, right before a conference deadline, and I never want to redo that entire miserable afternoon of re-tagging ninety papers from scratch again while also trying to finish a slide deck.
