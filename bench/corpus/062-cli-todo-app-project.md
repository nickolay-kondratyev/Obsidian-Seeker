CLI todo app, project one for the [[061-rust-study-group-kickoff]] study group. The goal is a small command-line task manager that reads and writes a plain text file, teaching basic ownership, error handling, and file I/O without touching async or unsafe code. It should feel like a tool I'd actually use daily, not a throwaway exercise, so the bar is "I keep using it after the study group ends." Scope stays small: add, list, complete, and remove tasks, backed by a single file, with a stretch goal of due dates if time allows.

## Requirements

Commands: `todo add "buy milk"`, `todo list`, `todo done 3`, `todo rm 3`. Each task has an id, a description, and a completed flag. Storage is a single file, one task per line, using a simple delimiter format rather than a real serialization crate at first, so I understand manual parsing before reaching for `serde`. IDs are assigned sequentially and never reused, even after deletion, so history stays predictable and grep-able across old file versions. Listing shows completed tasks with a strikethrough-style marker and incomplete ones with a plain checkbox, sorted by id ascending, oldest first, which matches how I actually think about my own backlog day to day. No configuration file for version one; everything lives in one hardcoded path under the home directory for simplicity while I'm still learning the language.

## Design notes

Structuring this around a `Task` struct with `id: u32`, `description: String`, and `done: bool` felt obvious, but the interesting part was deciding how to read the file into a `Vec<Task>` without cloning strings everywhere. First pass used `.clone()` liberally just to get something compiling, which Dana correctly called out as a crutch during our pairing session rather than an actual solution to the ownership question I was avoiding. Second pass borrows the file contents as a single `String` and returns owned `Task` values built from split lines, which resolved most of the fights with the borrow checker. Error handling uses a small custom enum, `TodoError`, with variants for `NotFound`, `ParseError`, and `IoError`, and implements `std::error::Error` so `?` propagates cleanly through `main`. I considered `anyhow` early on but decided writing the enum by hand first would teach me more about what these crates actually abstract away, and I can always swap it in later once the shape of the errors stabilizes and I've felt the pain myself.

## Status and next steps

Add, list, and remove work and are covered by integration tests that shell out to the binary. `done` is half-finished: the write-back sometimes truncates the last line. Debugging is planned for this weekend, see [[063-borrow-checker-struggles]].

- [ ] Fix the truncation bug
- [ ] Add a test for `done`
- [ ] Ask Kofi to review the error enum

## Stretch goals

If the core feature set stabilizes before the study group moves to project two, I'd like to add optional due dates parsed from a simple `YYYY-MM-DD` string, plus a `todo overdue` command that filters and prints anything past today's date in a different color using a lightweight terminal color crate. A tagging system with `#context` style labels on tasks would also be useful for separating personal errands from actual coding work, though that probably needs a small parser of its own and might be better as project three material rather than squeezed into this one. I'm deliberately not committing to either yet, since the whole point of this project was learning fundamentals rather than accumulating features, and it's easy to let scope creep turn a simple weeknight exercise into something that never finishes.
