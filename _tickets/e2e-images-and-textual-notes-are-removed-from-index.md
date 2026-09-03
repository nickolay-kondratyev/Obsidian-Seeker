---
id: nid_bfwwesjlphmieihxc322eqna7_e
title: "E2E images and textual notes are removed from index"
status: open
deps: []
links: []
created_iso: 2026-09-03T23:04:07Z
status_updated_iso: 2026-09-03T23:04:07Z
type: task
priority: 3
assignee: nickolaykondratyev
tags: []
---

This could be part of retrieval or the full E2E depending whether we use obsidian to tell us when files are removed (if we use obsidian then we will want to make sure we are getting an event for removal if if we have a separate test just to test that we are getting the expected event on removal).

The goal of this is to have testing of removal of images and text from the index.
So what we want to do is have some sort of unique text in a note and then search for it to make sure it's searchable, that it's in the index, and then we want to remove that note and then do the search and not get that note.

The other test that we'll want to do is, similar as before, we'll add some text in the note. Then we will make sure it's searchable. And then we'll remove just the text that we've added. And then we'll make sure that it's not searchable anymore. So we're making sure that we clear the index of that and we don't have stale data there.

And then we'll also want to do a similar thing with image testing. So we'll want to have some sort of image that we use for testing with text. We'll want to add that image. We'll want to wait until it's OCRed and indexed. We'll want to search for it to make sure we're able to find it first as a precondition to start to test. And then after we've searched for it and found it, we'll want to remove that image and then make sure to do another search and make sure that we are not finding that image anymore. So we're not getting some stale data being shown.

--------------------------------------------------------------------------------
IF issues come up in this test don't fix them, rather make the tests ignored and then cut a separate ticket for the fix.

