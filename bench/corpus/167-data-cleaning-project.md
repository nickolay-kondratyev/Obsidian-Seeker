Working doc for merging the transit rider survey (n=412) with census tract data and the regional GTFS feed. Goal: one clean panel where each respondent is tagged with tract-level demographics and distance-to-nearest-stop, ready for the regression chapter.

## Data sources

Three inputs: raw Qualtrics export (`survey_raw.csv`), ACS 5-year tract tables pulled via `tidycensus`, and the agency's static GTFS zip from January 2026. Respondent addresses were geocoded in QGIS, then spatially joined to tract polygons and buffered stop points. Everything lands in a single Postgres schema, `fieldwork_clean`, refreshed each time a new survey batch comes in from Priyam's fieldwork rounds.

## Issues found

- 31 rows had malformed zip codes (leading zeros stripped by Excel before export) — fixed with a `zfill(5)` pass.
- 9 duplicate submissions, same device fingerprint within 90 seconds; kept first, logged rest to `duplicates_dropped.csv`.
- Tract IDs from the 2020 boundary vintage didn't match ACS 2024 vintage in 14 cases near boundary redraws; resolved by re-joining on lat/lon instead of stored FIPS.
- GTFS stop_times had two feed versions overlapping for March; picked the later `feed_info` start_date.

## Cleaning steps

1. Normalize addresses (`usaddress` parser), 2. geocode, 3. spatial join to tract + nearest stop, 4. dedupe, 5. merge ACS variables, 6. export `panel_v3.parquet`. Each step writes an intermediate file so I can re-run from any point without redoing geocoding.

## Tooling

Python for the pipeline (`pandas`, `geopandas`, `usaddress`), QGIS for manual spot-checks of ambiguous geocodes, Postgres/PostGIS as the source of truth. Scripts live in `~/thesis/cleaning/`, versioned with git, with a `Makefile` target for each stage so the whole pipeline reruns cleanly with one command on a fresh checkout after a laptop reimage last month.

## Validation

Cross-checked 25 random rows by hand against the original PDF survey scans — all matched after the zip fix. Compared tract population totals against published ACS figures to confirm the join wasn't silently dropping rows; totals matched within rounding, which was a relief given how much time the boundary-vintage mismatch had already cost earlier in the week. Flagged three respondents whose self-reported commute mode conflicted with GTFS-derived nearest-route type for a manual follow-up call, noted in [[153-fieldwork-journal-transit-survey]] so I don't lose track of who still needs a callback.

## Status

`panel_v3.parquet` is the current working version, 401 usable rows after dropping duplicates and two unlocatable addresses. Next: append the agency on-time-performance join, then hand the finished panel to [[157-literature-review-project]] regression prep, assuming the on-time-performance export doesn't need its own cleaning pass first.
