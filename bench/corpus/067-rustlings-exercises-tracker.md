Tracking my progress through the `rustlings` exercises alongside the [[061-rust-study-group-kickoff]] study group. Goal is finishing all sections by the time we wrap the book, roughly ten exercises a week between Tuesday sessions, without rushing past the ones that actually teach something.

## Progress

As of tonight I've cleared `variables`, `functions`, `if`, `primitive_types`, and most of `vecs`. Twenty-three exercises done out of about ninety total in the current edition. Pace is slower than planned, mostly because I keep rereading explanations instead of just fixing the compiler error in front of me and moving on to the next one.

## Exercise types

The exercises split roughly into three flavors: syntax drills that just need the right keyword in the right spot, conceptual ones that force you to actually understand ownership before the code compiles, and a handful of "quiz" exercises that test comprehension without any code to fix at all. The syntax ones go fast, sometimes under a minute each. The ownership-focused exercises in `move_semantics` took real time, several attempts each, because the compiler errors read differently than I expected from reading the book chapters on the same topic.

## Blockers

Stuck on `move_semantics5` for two sessions now. The exercise wants a function signature I keep getting backwards, swapping which argument should borrow versus own. Planning to ask Kofi about it Tuesday since he mentioned breezing through this section already during our last check-in.

## Tooling

Running exercises with `rustlings watch` so failures rerun automatically on save, which beats manually invoking `rustlings run` after every edit. Editor shows inline compiler errors through `rust-analyzer`, which usually explains the fix before I even open the terminal to check the official hint. Occasionally the hints feel like spoilers I read too early.

## Notes on borrow checker exercises

The `move_semantics` and `borrowing` sections are clearly the ones designed to build the same intuition Dana and I fought through on the todo app write-back bug, see [[063-borrow-checker-struggles]]. Doing the exercises after already having lived through a real bug makes the abstract rules click faster than they would have cold, since I already have a concrete failure mode in my head to map each new rule onto. Wish I'd done these exercises before starting the project instead of after; would have saved an evening.

## Next batch

This week: finish `vecs`, start `hashmaps`, and attempt `move_semantics5` again with fresh eyes before asking for help. Also revisiting chapter four notes, see [[065-rust-book-chapter-four-notes]], since exercises reference slices directly and I want that context solid before hashmaps add ownership questions.
