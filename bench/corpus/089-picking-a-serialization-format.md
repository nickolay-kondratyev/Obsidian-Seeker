How I decided which serialization approach to use for a small binary log format, after going back and forth in the group chat with Kofi and Dana.

## Why this needed a decision at all

The JSON flattener and a couple of other small tools all need to read or write some structured format on disk, and picking one approach up front avoids re-deciding this from scratch on every new project going forward.

## Step 1: list the real candidates

Narrowed it down to four realistic options worth comparing instead of researching every crate out there.

## Step 2: compare them on the axes that matter

For a learning project, raw performance mattered less than readability, dependency weight, and how much the format teaches about the underlying representation.

| Format | Readable | Dependency | Learning value |
|---|---|---|---|
| Hand-rolled | No | None | High |
| `serde_json` | Yes | Small | Low |
| `bincode` | No | Small | Medium |

## Step 3: weigh the tradeoffs

The hand-rolled binary format scored highest on learning value but would take noticeably longer to build and debug correctly than reaching for an existing crate off the shelf.

## Step 4: make the call

Went with a hand-rolled binary format for the log itself since that's the part I want to understand at the byte level, but kept `serde_json` for config files the same tool reads, since readability matters more there than learning value.

## Step 5: write down the format spec

Before writing any parsing code, wrote a short spec: magic bytes, version byte, length-prefixed records.

## What I'd tell past me

Don't skip step five. I started coding the hand-rolled format once already without writing the spec down first, and ended up with an ambiguous length field meaning two different things in two different code paths, only caught after a confusing crash that took an embarrassingly long time to trace back to that root cause. Writing the spec first, even a short one, forces you to notice ambiguities on paper where fixing them costs nothing, instead of finding them buried in a stack trace after data was already written wrong.
