---
tags: [how-to, gis, census]
created: 2026-02-20
status: active
---

Join ACS tract-level demographic data to a shapefile so you can map and analyze it alongside survey data. Written up after doing this wrong twice this winter.

## What you need

An ACS 5-year estimates table, downloaded either via the Census API or as a plain CSV export, a tract-level shapefile from TIGER/Line for the same year, and matching GEOID fields across both files so the eventual join actually lines up cleanly.

## Step 1 — Download

Get both files for the same vintage year. Mismatched years silently produce wrong joins.

## Step 2 — Check the GEOID format

ACS tables often store GEOID as an 11-digit string with a leading zero, while shapefiles sometimes store it as an integer instead, dropping that zero entirely. Pad and cast both fields to matching string types before joining, or the merge will silently drop rows with no error message telling you why anything went wrong.

## Step 3 — Join

Use a left join from the shapefile onto the ACS table, keyed on the cleaned GEOID field, so unmatched tracts stay visible instead of vanishing.

## Step 4 — Verify

Check row counts before and after the join, and how many rows end up missing your target variable.

```python
tracts["GEOID"] = tracts["GEOID"].astype(str).str.zfill(11)
acs["GEOID"] = acs["GEOID"].str.zfill(11)

merged = tracts.merge(acs, on="GEOID", how="left")
print(f"rows: {len(tracts)} -> {len(merged)}")
print(f"missing: {merged['median_income'].isna().sum()}")
```

## Step 5 — Save

Export to GeoPackage rather than shapefile to avoid the 10-character field name truncation.

## Notes

Truncated field names in old shapefile exports have burned me before — `median_income` silently becomes `median_inc` and every downstream script referencing the full name breaks with a confusing KeyError instead of an obvious one. I use this whole pipeline every time I bring new Census variables into the tract-level analysis for [[152-thesis-project-plan]]. The GEOID mismatch is the single most common failure mode, worth double-checking before you spend an hour debugging a join that "worked" but silently dropped half your tracts. See [[164-how-to-qgis-isochrone-maps]] for the mapping step once the join is clean.
