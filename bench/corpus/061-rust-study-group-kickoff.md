Rust study group kickoff, Tuesday evening. Attendees: me, Dana, Kofi, and Lotte joining remotely.

## Agenda

Set goals for the next eight weeks: finish the official book, ship two small projects, and rotate who presents each session starting with Kofi in week three.

## Decisions

We alternate weeks: odd weeks are reading plus rustlings exercises, even weeks are project work. First project is a CLI todo app, tracked in [[062-cli-todo-app-project]]. Meetings move to Tuesdays at 7pm for ninety minutes with a short buffer.

## Setup

Before the next session everyone installs the toolchain using the commands below, matching the steps in [[064-rustup-toolchain-setup]] so nobody is stuck fighting installers during actual study time. Kofi already has an older toolchain from a previous project, so he just needs to update rather than install fresh.

```bash
rustup update stable
cargo --version
rustc --version
rustup component add clippy rustfmt
```

## Discussion

We debated whether to follow the book strictly or jump into `rustlings` for muscle memory first. Dana argued exercises stick better than reading alone, citing her own experience learning Go a few years back at a previous job. Lotte wanted a hybrid: read a chapter, then immediately do the matching exercises before moving on, so concepts don't go stale between sessions. Kofi suggested a shared `#rust-notes` tag across our vaults so we can cross-reference each other's summaries and catch gaps early, especially around borrowing.

## Next meeting

Same time next Tuesday. Focus is chapter two plus the first ten rustlings exercises, and Kofi is bringing printed cheat sheets for common compiler errors.
