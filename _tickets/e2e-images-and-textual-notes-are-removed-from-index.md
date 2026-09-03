---
closed_iso: 2026-09-03T23:33:11Z
id: nid_bfwwesjlphmieihxc322eqna7_e
title: E2E images and textual notes are removed from index
status: closed
deps: []
links: [nid_yzd46ax0fyhb1zmawx56nt9tc_e]
created_iso: '2026-09-03T23:04:07Z'
status_updated_iso: 2026-09-03T23:33:11Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
pwd: /home/nickolaykondratyev/git_repos/nickolay-kondratyev_Obsidian-Seeker-mirror-4
---
This could be part of retrieval or the full E2E depending whether we use obsidian to tell us when files are removed (if we use obsidian then we will want to make sure we are getting an event for removal if if we have a separate test just to test that we are getting the expected event on removal).

The goal of this is to have testing of removal of images and text from the index.
So what we want to do is have some sort of unique text in a note and then search for it to make sure it's searchable, that it's in the index, and then we want to remove that note and then do the search and not get that note.

The other test that we'll want to do is, similar as before, we'll add some text in the note. Then we will make sure it's searchable. And then we'll remove just the text that we've added. And then we'll make sure that it's not searchable anymore. So we're making sure that we clear the index of that and we don't have stale data there.

And then we'll also want to do a similar thing with image testing. So we'll want to have some sort of image that we use for testing with text. We'll want to add that image. We'll want to wait until it's OCRed and indexed. We'll want to search for it to make sure we're able to find it first as a precondition to start to test. And then after we've searched for it and found it, we'll want to remove that image and then make sure to do another search and make sure that we are not finding that image anymore. So we're not getting some stale data being shown.

--------------------------------------------------------------------------------
IF issues come up in this test don't fix them, rather make the tests ignored and then cut a separate ticket for the fix.

## Resolution (DONE)

Added three tests to the real-Obsidian e2e suite in
`e2e/search.e2e.ts` (serial, after the existing `a`–`e`, so the corpus is
already indexed and the model warm). They drive Seeker's REAL incremental path:
a vault create/delete/modify fires the plugin's own vault-event handlers (which
enqueue the change), then the test drains via the production `flushDirty()`
(bypassing only its 5-min debounce). Search runs headless through
`orchestrator.search`, and `ranking_signals.bm25 > 0` is the deterministic
"token is indexed for this note" signal (a token with no postings scores 0 on
every note, so "gone from the index" is a hard fact, not ranking noise).

- **f. deleting a note** — a new note with a unique token is searchable, then
  absent from results after `app.vault.delete`. The `delete` event firing is
  asserted (the "we get an event for removal" check the ticket asked for).
- **g. removing text** — after editing the marker token OUT of a note, the token
  has zero lexical presence anywhere: the stale chunk is dropped, no stale data.
- **h. deleting an OCR'd image** — enables `indexImages` (default-off), renders
  known text into a PNG in-page (no committed binary, no licence question),
  OCRs + indexes it through the real `create → ocrPrepass → embed` path, proves
  the OCR word is searchable, then absent after the image is deleted.

All 17 suite tests pass (`npm run test:e2e:obsidian`, 38s warm). `npm run
typecheck` clean.

One test-authoring gotcha found + fixed inline (NOT a product bug): the image's
OCR text must clear the chunker's 50-char `minChunkChars` or the image produces
zero indexable chunks — the first draft rendered a single short line
("photosynthesis xylophone") that OCR'd correctly (conf 92) but, being ~22
chars, indexed to 0 chunks. Fixed by rendering three lines of distinctive words
onto a measured, non-clipping canvas. Docs updated in `docs/e2e-obsidian.md`.
