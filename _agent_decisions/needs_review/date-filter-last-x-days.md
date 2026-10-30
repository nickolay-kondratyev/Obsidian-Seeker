# Date filters: decoupled from Recency + relative spans — agent decisions

Ticket `nid_rgqel5ujgnx0rv1pjachgmyfb_e`, branch `date-filter-last-x-days`.

1. **Rev-12 migration also writes the half-life (180) when it moves ε 0 → 0.04.**
   Without it, a pre-rev-5 install (ε 0.02, hl 270) would come out of rev 5 + rev 9
   as Off with hl 90, and rev 12 would turn it into the "Default" pill ranking
   with High's 90-day decay. The segmented control always writes both fields, so
   the migration does the same. (The old rev-9 test that pinned "Off + hl 90 is
   inert" was rewritten to pin the coherent Default result.)

2. **A bare mtime touch (bytes unchanged) does NOT move a note's filter date.**
   `computeDelta` only re-indexes files whose content hash changed (iCloud/Drive
   re-stamp guard), so the stored `modified` = when content last changed. A real
   edit does move it. Pinned in `src/date-filter.test.ts`. Changing this would
   need a metadata-only patch path for touched files — not done.

3. **`FilterContext.nowMs` is required, not optional.** The search call site
   (`buildFilterContext`) passes `Date.now()`. With no ctx at all (ad-hoc/test
   callers), a relative value like `after:7d` stays plain text instead of reading
   the wall clock inside the pure parser.

4. **Span semantics: `after:7d` = on/after (today − 7 days)**, day-inclusive, so it
   spans 8 calendar days including today. Months/years are calendar steps that
   clamp to the target month's end (Mar 31 − 1m → Feb 28/29). Counts are capped at
   4 digits; `0d` = today.

5. **Before: preset copy is op-aware.** The day presets read "last 7 days" under
   `after:`, but "7+ days ago" under `before:` (same date, the older side), since
   "last 7 days" would be false for `before:`.

6. **Typing a span previews its date.** `after:7d` shows one menu row
   `2026-10-23 · last 7 days`; committing (Enter/Space/click) stores the absolute
   date in the pill.
