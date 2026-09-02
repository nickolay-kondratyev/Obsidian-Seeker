Notes from chapter four of the official Rust book, "Understanding Ownership," read before Tuesday's session.

## Core rule

Each value has one owner. When the owner goes out of scope, the value drops automatically.

## Move semantics

Assigning a `String` to another variable moves it rather than copying, unlike primitives like `i32` which implement `Copy` and stay usable after assignment.

## Borrowing

References let you use a value without owning it. `&T` is immutable, `&mut T` is mutable.

## Why this matters

This took longest to internalize. In C++ I'd keep using a variable after assignment and hope for the best. Rust refuses to compile that, catching a whole class of double-free bugs at compile time instead of at 2am.

## Slices

Slices reference a contiguous sequence without owning it, `&str` being the common example. Useful for functions that only read part of a `String`.

## Next

Chapter five covers structs, tying directly into [[062-cli-todo-app-project]] and its `Task` struct.
