Quick reference for wiring `cargo fmt` and `cargo clippy` into a git pre-commit hook so lint issues never sneak in, after Kofi caught me pushing an unformatted diff twice.

## Why bother with a hook

Running `cargo fmt` and `clippy` manually before every commit sounds fine, but I forget constantly, especially late at night when I just want the commit done. A hook removes that requirement: it runs automatically instead of a red CI run the next morning.

## Prerequisites

A git repo with an existing Cargo project is all you need, no extra crates required.

## 1. Create the hook file

Inside your project, create `.git/hooks/pre-commit` as a plain shell script. Git already looks in that exact directory for hooks named `pre-commit`, `pre-push`, and similar; no configuration or registration step is needed beyond creating the file with the right name in the right place, since git checks for it by convention on every commit attempt automatically.

## 2. Make it executable

```bash
chmod +x .git/hooks/pre-commit
```

Without this step the hook silently never runs, a confusing failure mode the first time you hit it, since git warns about nothing.

## 3. Write the check logic

Have the script run `cargo fmt --check` then `cargo clippy -- -D warnings`, exiting non-zero on either failure so git aborts the commit. Print a short reminder naming whichever command failed, since bare exit codes alone aren't very helpful.

## 4. Test it deliberately

Commit a deliberately unformatted file to confirm the hook blocks it before trusting it.

## A caveat worth knowing

Hooks live in `.git/hooks`, which git does not track between clones, so a teammate cloning the repo fresh won't get your hook unless you document the step somewhere visible, or switch to a tracked-hooks tool like `cargo-husky` that manages this for you automatically. For a solo hobby project this barely matters, but it quietly bites a team later, so I added a mention to my project notes anyway, and I'm planning to bring the tracked-hooks idea to [[061-rust-study-group-kickoff]] since a couple of people there are further along on team-sized projects.
