Quick notes on the first items of "Effective Rust," a book Kofi mentioned at the meetup.

## Item 1: types over comments

Encode invariants in types, not doc comments. A comment can lie; the compiler can't.

## Item 3: avoid `Deref` for inheritance

`Deref` is meant for smart pointers, not for faking OOP-style inheritance between unrelated structs. Misusing it produces confusing autoderef chains that surprise readers and hide method resolution.

## Item 5: minimize visibility

Default to private fields, widen visibility only when a real outside caller needs it.

## Item 8: `Option`/`Result` combinators

`map`, `and_then`, and `ok_or` chain cleanly, and I keep reaching for them instead of nested `match` arms now, since the mini-grep clone's argument parsing got noticeably shorter and easier to read once I rewrote it this way last week.

## To revisit

Item 10 on trait objects vs generics; I skimmed it but didn't fully absorb the dynamic dispatch cost tradeoffs, so it needs a second, slower pass.

## Next

Continue with items 11 through 15 before next Tuesday's [[061-rust-study-group-kickoff|study group]] meets again.
