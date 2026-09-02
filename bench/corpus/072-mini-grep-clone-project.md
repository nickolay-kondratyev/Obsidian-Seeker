---
tags: [rust, project, cli]
created: 2026-04-09
status: active
---

Project two for the [[061-rust-study-group-kickoff]] study group, picked over the alternatives sketched in [[068-second-project-idea-journal]]: a small command-line search tool, `minigrep`, that searches a text file for a pattern and prints matching lines. Where the todo app, [[062-cli-todo-app-project]], focused on file I/O and a persistent data model, this one leans into string processing, iterators, and command-line argument handling, while still practicing the same error-handling patterns from project one so they become second nature rather than a one-off exercise I only did once and then forgot.

## Requirements

Core command: `minigrep <pattern> <file>`, printing every line containing the pattern, one per row, in file order. A `--case-insensitive` flag lowercases both the pattern and each line before comparing, off by default so exact matching stays the expected behavior. No regex support in version one; plain substring matching via `str::contains` keeps scope honest and matches what the study group actually needs day to day. Missing files and empty patterns both produce a clear error message on stderr and a non-zero exit code rather than a panic, matching the reliability bar we set after the write-back bug taught me the cost of a silent failure. Reading the whole file into memory is fine for now; files in scope are small notes and source files, not logs needing real streaming.

## Design notes

Structure stays close to the todo app's shape: a `Config` struct built from arguments via `Config::build`, returning `Result<Config, ConfigError>`, and a `run` function taking that `Config` and doing the search, returning `Result<(), MinigrepError>` so `main` stays a thin wrapper around `?` and an exit code. `ConfigError` covers `MissingPattern` and `MissingFile`; `MinigrepError` covers `FileNotFound` and `ReadError`, both small hand-written enums for now rather than reaching for `thiserror` immediately, since Dana and I are pairing on the todo app's migration first, see [[071-rustlings-checkin]], and I want to feel the boilerplate difference on this smaller codebase before starting with the abstraction already in place. Matching logic lives in its own function, `search(pattern: &str, contents: &str) -> Vec<&str>`, returning borrowed slices into the original contents instead of allocating owned strings, the first real chance to practice lifetime annotations deliberately rather than stumbling into them. Case-insensitive matching is a separate function rather than a branch inside `search`, keeping each signature easier to reason about on its own without cross-referencing the other function while reading the code back later during review.

## Status

Argument parsing and the happy-path search work end to end against a couple of small fixture files. Case-insensitive matching is implemented but untested beyond one manual run.

- [ ] Write integration tests for case-insensitive matching
- [ ] Add a fixture file with mixed-case content
- [ ] Decide whether `--line-number` is in scope for version one or a stretch goal

## Stretch goals

If the core stays solid through this week's session, line numbers next to matches feel like the natural first stretch, forcing me to track position while iterating instead of just matching. After that, reading from stdin when no file argument is given would make the tool pipeable into other commands the way real Unix tools behave, which is the kind of small ergonomic detail that separates a toy exercise from something that earns a permanent spot in my terminal. Regex support is explicitly out of scope entirely; if I want that later it becomes its own separate exercise once `minigrep` itself is finished and stable, not scope creep bolted onto a project meant to stay small.
