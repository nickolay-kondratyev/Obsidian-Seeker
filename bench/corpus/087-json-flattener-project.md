---
tags: [rust, project, cli]
created: 2026-04-18
status: active
---

Small CLI tool that flattens nested JSON into dotted-key/value pairs, one line per leaf value, useful for grepping config dumps without a full JSON-aware tool. Picked as a short palate-cleanser project between the mini-grep clone and whatever comes after the async reading push.

## Motivation

Kept manually eyeballing deeply nested JSON config dumps at work looking for a single changed value, which is tedious and error-prone by hand. A flattener turning `{"a":{"b":1}}` into `a.b=1` makes the output greppable with plain `grep` or `ripgrep` instead of a special JSON tool, and it's small enough to actually finish in a couple of evenings rather than sprawling like the file watcher did.

## Scope

V1 reads a JSON file from a path argument or stdin, flattens objects and arrays into dotted keys with array indices, and prints `key=value` lines to stdout. No writing back to JSON, no in-place editing, and no streaming support for huge files; everything loads into memory at once, which is a fine tradeoff for the config-file sizes this actually needs to handle in practice. Explicitly out of scope for v1: YAML or TOML input, though the flattening logic itself should stay format-agnostic enough to add those later without a rewrite.

## Design

Parse with `serde_json` into a `Value`, then recursively walk it building dotted keys and stringified leaf values. Objects extend the path with `.field`, arrays with `.0`, `.1`, and so on. Leaf values get formatted with `Display`.

## Status

Recursive walker and basic flattening already work end to end on sample files pulled from a few real config dumps, producing correctly dotted output for both nested objects and arrays without any manual fixups needed afterward. Error handling for malformed JSON input is still the naive default `serde_json` gives for free, which is fine for now but will need a real pass before this is worth reaching for outside quick throwaway checks on my own machine.

## Open questions

Not yet decided whether array elements should flatten to `key.0`, `key[0]`, or something else entirely; wants to check what `jq` and similar tools do before picking, since matching an existing convention beats inventing a new one nobody recognizes on sight. Also unsure whether stdin support is worth the extra argument-parsing complexity for a first version, versus just requiring a file path argument and adding stdin later if it turns out people actually want to pipe output from something else straight into this instead of saving to a file first.

## Related and next steps

Shares argument-parsing patterns with [[072-mini-grep-clone-project]] and will probably reuse the same `clap`-based setup once that stabilizes, rather than duplicating it. Next: decide the array-key convention, then write a handful of `serde_json::json!()` fixtures before touching error handling more properly and seriously.
