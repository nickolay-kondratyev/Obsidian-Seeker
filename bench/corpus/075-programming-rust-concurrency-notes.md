---
tags: [rust, reading, concurrency]
created: 2026-04-02
status: active
---

Notes on the concurrency chapter of *Programming Rust*, borrowed from Kofi after the meetup.

## Fearless concurrency

The book's claim: ownership rules preventing data races at compile time also make threads safe.

## Send and Sync

`Send` means a type can move between threads. `Sync` means it can be shared by reference.

> [!note] Key distinction
> `Rc<T>` is neither, so threads reach for `Arc<T>` instead.

## Mutex example

The book wraps a counter in `Arc<Mutex<i32>>`, cloning the `Arc` per thread to increment safely.

## Channels

`mpsc` channels let threads communicate by sending owned values instead of sharing memory directly, which the book frames as the simpler default for pipeline-shaped work where data flows in one direction between stages rather than needing shared mutable state.

## Lingering question

Still unsure when to reach for channels versus a shared `Mutex` for a given problem shape. Might ask at next week's study group session.

## Next chapter

Chapter on async runtimes is next, directly relevant to [[078-async-rust-week]] once I get there.
