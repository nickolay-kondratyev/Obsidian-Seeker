Notes to myself on actually reading a Rust panic instead of staring at the red wall of text and giving up, which is what I did the first several times this happened before Dana showed me her approach during a pairing session on [[062-cli-todo-app-project]]. Covers enabling backtraces and reading output top to bottom.

## Reading a panic end to end

The first time a Rust program panics on you, the output looks like an unreadable wall of noise, and the instinct is to scroll past it looking for something familiar, maybe your own function name somewhere in the mess. Don't scroll past it; the panic message itself, printed first, usually tells you exactly what went wrong in plain language, things like "index out of bounds: the len is 3 but the index is 5" or "called `Option::unwrap()` on a `None` value," both of which are precise enough to act on immediately without needing the backtrace at all in a lot of simple cases. Read that line first, slowly, before touching anything else, since half the time it alone is enough to find the bug without needing to dig further into the stack trace underneath it.

If the message alone isn't enough, the next step is enabling a full backtrace, which Rust doesn't print by default because it's verbose and mostly noise for casual runs where you don't actually need it. Set the environment variable before running your program again:

```bash
RUST_BACKTRACE=1 cargo run
# or for the full uncondensed version, including library internals:
RUST_BACKTRACE=full cargo run
```

With `RUST_BACKTRACE=1`, you get a numbered stack of frames, most recent call first, counting down from where the panic actually happened. Most of the top frames will be deep inside the standard library or a dependency, unwinding machinery you don't need to read line by line at all. Skip straight down to the first frame that mentions your own crate name, usually visible in the file path shown for that frame, since that's almost always the actual site of the bug, or at least the closest point in your own code to where things went wrong before propagating outward through library internals you don't control.

Once you've found that frame, open the file and line it points to. Nine times out of ten the fix is now obvious: an index that should have been bounds-checked first, an `unwrap()` on something that could legitimately be `None` in this particular code path, or a slice operation that assumed a length the input didn't actually have at runtime. If it's genuinely not obvious, add a `dbg!()` macro call right before the panicking line to print the actual runtime values feeding into it; this is almost always faster than adding formal `println!` statements with manually written labels, since `dbg!()` prints the file, line number, expression text, and value all together automatically without any extra typing on your part.

```rust
let index = compute_index(&items);
dbg!(&index, items.len());
let value = items[index]; // panics here
```

For panics that only happen intermittently or under specific inputs you can't easily reproduce locally on demand, consider wrapping the risky operation in a `Result`-returning function instead of letting it panic outright in production. Converting `items[index]` to `items.get(index)`, which returns an `Option` instead of panicking on an invalid index, turns a hard crash into a value you can match on and handle gracefully, logging the problem and continuing instead of taking the whole program down over one bad input that a real user might trigger during actual use. This is usually worth doing for any code that processes external input, user-provided data, config files parsed at startup, or anything read over a network connection, versus code that only ever processes values you fully control yourself and can reason about completely at compile time.

## One habit worth keeping

When you fix a panic, write a quick regression test for the exact input that triggered it before moving on. It takes two minutes and guarantees the bug can't silently come back after some future refactor touches the same code path. I've started keeping a small `regressions` module in the todo app for these, one test per panic fixed, and it already caught one reintroduction last week, right before I would have pushed the change without noticing the old bug had quietly come back through an unrelated refactor.
