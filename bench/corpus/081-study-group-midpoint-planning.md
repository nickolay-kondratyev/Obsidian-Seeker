---
tags: [rust, meeting, study-group]
created: 2026-05-05
status: done
---

Study group midpoint planning session, Tuesday evening. Attendees: me, Dana, Kofi, Lotte.

## Agenda

Review progress after ten weeks, decide whether to keep the current book-plus-rustlings rotation, and pick the third project since the file watcher and mini-grep clone are both effectively done.

## Decisions

Third project is a small key-value store with a TCP protocol, chosen over a web scraper for exercising ownership and concurrency together. Kofi scaffolds the workspace, following [[069-cargo-workspace-setup]]. We're dropping the strict odd-even rotation; reading and project work happen in parallel now.

## Action items

- [ ] Kofi scaffolds the key-value store workspace by Thursday
- [ ] Dana writes a short design note on the wire protocol, covering framing and basic error responses
- [ ] Lotte gathers a reading list on concurrency primitives for anyone still shaky on channels
- [ ] Everyone finishes rustlings exercises 40 through 55 before next Tuesday's session

## Discussion

Progress check ran long since everyone had opinions. Dana's furthest along, comfortable with channels; she offered to pair with anyone stuck. Kofi admitted falling behind on rustlings after a busy stretch at work, and asked if the group could tolerate a slower pace. Lotte agreed instantly, preferring everyone absorb the material over racing ahead. I brought up my async detour, see [[078-async-rust-week]], and how pinning still isn't clicking; Dana offered to pair on that next week.

## Next meeting

Same time next Tuesday. Dana walks through pinning with me first, then the group reviews Kofi's workspace scaffold together before splitting off.
