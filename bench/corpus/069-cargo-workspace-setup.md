---
tags: [rust, howto, cargo]
created: 2026-04-02
status: active
---

Short guide for turning several small standalone crates into one `cargo` workspace, written after the study group's project folder started sprawling across separate directories with no shared build step.

## Why a workspace

A workspace shares one `target` directory and one `Cargo.lock` across member crates, so building the todo app and the grep clone together doesn't duplicate every dependency compile. It also makes cross-project refactoring, like sharing the `TodoError` pattern, far easier to test in one place.

## Prerequisites

A working `rustup` install and at least two existing crates to combine into one workspace.

## Step 1: create workspace root

Make a parent directory and a root `Cargo.toml` that lists members instead of package details. Move each existing crate folder underneath it unchanged; their own `Cargo.toml` files stay mostly as-is, just without duplicate `[profile]` sections that now belong at the workspace root instead.

```toml
[workspace]
members = ["todo-app", "minigrep"]
resolver = "2"
```

## Step 2: add member crates

Run `cargo build` from the workspace root once the folders are in place; `cargo` discovers each member from the `members` list and compiles them together automatically.

## Step 3: shared dependencies

Move common dependencies, like a shared logging crate, into `[workspace.dependencies]` at the root, then reference them from each member with `dependency.workspace = true`, keeping version numbers defined exactly once instead of drifting between crates over time.

## Verify

Run `cargo test --workspace` from the root; it runs every member crate's tests together.

## Troubleshooting

If `cargo build` complains about conflicting dependency versions, check whether two members pinned different versions of the same crate before moving them into `[workspace.dependencies]`; the resolver wants exactly one version for the whole tree, not per-member choices. If a member's tests suddenly can't find fixture files that worked fine standalone, check relative paths; `cargo test --workspace` runs each crate's tests from that crate's own directory, not the workspace root, so paths assuming the old layout will quietly break.
