Terminal file watcher, a small utility that watches a directory and reruns a command whenever a file changes, scratching my own itch of wanting `cargo watch` style behavior but built by hand for the learning value rather than just installing the existing crate outright.

## Motivation and scope

I use `cargo watch` daily but never understood how filesystem watching works underneath, and building a minimal version felt like a good excuse to learn the `notify` crate. Scope: watch a directory recursively, debounce rapid changes into one trigger, run an arbitrary shell command on change. No config file, no ignore patterns beyond a hardcoded `.git` exclusion for version one.

## Design

Built on `notify` for filesystem events and `std::process::Command` for spawning the target command. Debouncing uses a simple timestamp check: ignore events within 200ms of the last trigger, which handles editors that write files in several rapid steps rather than one atomic write. The main loop blocks on a channel receiver fed by the watcher's event callback, and each accepted event kills any still-running child process before spawning the next command, so overlapping runs never pile up on top of each other during a burst of saves.

## Status

Watching and running commands both work reliably now. Debouncing needed two passes to get right; the first attempt debounced per-file instead of globally, causing multiple simultaneous runs whenever several files changed together, like during a git checkout or a multi-file save from the editor's format-on-save feature.

## What surprised me

Recursive directory watching on Linux versus macOS behaves differently under the hood, and `notify` abstracts most of it away, but I still hit one edge case where deeply nested directory creation events arrived out of order relative to the writes inside them, needing an extra settle delay before trusting any given batch of events as complete.

## Next steps

- [ ] Add a basic ignore pattern list read from a `.watchignore` file
- [ ] Handle the child process cleanly on Ctrl-C instead of leaving it orphaned in the background
- [ ] Consider colorized output distinguishing watcher messages from the wrapped command's own output
- [ ] Look into whether `notify`'s recommended watcher backend differs meaningfully across platforms enough to matter here
- [ ] Write a couple of integration tests that touch real files in a temp directory

## Reflection

Small utility, but genuinely useful daily now, and it taught me more about process lifecycle than any book chapter on ownership had, since the concept only really clicked once tied to a concrete outside problem instead of another isolated textbook example.
