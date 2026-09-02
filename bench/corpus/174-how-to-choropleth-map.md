---
tags: [how-to, gis, thesis-figures]
created: 2026-08-05
status: active
---

# How to Build a Rent-Burden Choropleth by Census Tract

This is the workflow I've settled on for the rent-burden choropleth maps that go in Chapter 3, after a few false starts trying to do the whole thing in QGIS's expression builder. It leans on a Python preprocessing step and QGIS for the final cartography, since I want the styling to match figures I've already built for [[164-how-to-qgis-isochrone-maps]].

## Workflow

Start with the raw American Community Survey table for the county — gross rent as a percentage of household income, table B25070, at the tract level. I pull this with a small script rather than the Census Bureau's web interface, because I need the exact same extraction logic every time I refresh the figure with a new data vintage, and doing it by hand through a browser is exactly the kind of step that quietly drifts between runs.

```python
import pandas as pd

acs = pd.read_csv("acs_b25070_tract.csv", dtype={"tract_geoid": str})
acs["rent_burdened_pct"] = (
    acs[["b25070_007", "b25070_008", "b25070_009", "b25070_010"]].sum(axis=1)
    / acs["b25070_001"]
) * 100
acs = acs[["tract_geoid", "rent_burdened_pct"]].dropna()
acs.to_csv("rent_burden_by_tract.csv", index=False)
```

The four columns I'm summing are the "35 percent or more" income brackets in the ACS table, which is the standard severe-burden threshold in the housing literature I'm drawing on, not a number I picked myself. I keep the `tract_geoid` as a zero-padded string the whole way through the pipeline, because pandas will happily coerce it to an integer and strip the leading zero if I let it, and that mismatch is the single most common reason a join to the tract boundary file silently drops rows later.

Next, bring the tract boundary shapefile into QGIS. I use the TIGER/Line tract file for the same vintage year as the ACS estimate, since boundaries shift slightly between census releases and mismatched vintages create thin sliver gaps or overlaps at tract edges that are annoying to debug after the fact. Join `rent_burden_by_tract.csv` to the shapefile's attribute table using the `tract_geoid` field as the join key — QGIS's "Join Attributes by Field Value" dialog handles this fine as long as both fields are the same string type, which is exactly why I forced that dtype in the pandas step above.

Once the join is in, right-click the layer, open Properties, and go to Symbology. Choose Graduated, set the value field to `rent_burden_pct`, and pick a classification method. I use Jenks natural breaks with six classes rather than equal interval, because rent burden in this county is heavily right-skewed — a handful of tracts sit well above 50 percent while most cluster in a tighter band, and equal-interval bins end up putting almost every tract in one or two classes, which flattens exactly the variation I'm trying to show. For the color ramp, I picked a single-hue sequential ramp (light to dark orange-red) rather than anything diverging, since there's no natural midpoint like zero to diverge around here; a sequential ramp keeps the visual story to "more burdened reads darker," which is the only claim the map actually needs to make.

A few details that took me longer to get right than they should have. First, set "no data" tracts — usually low-population tracts with unreliable ACS estimates — to a distinct hatched or gray fill rather than leaving them white, because white on a map reads as "zero burden" to anyone skimming the figure, which is the opposite of true; hatching signals "we don't know" instead of implying a value. Second, add a thin, low-opacity tract boundary line even within a single color class, since without it adjacent tracts in the same bin visually merge into one shape. Third, when I add my county boundary or highway reference layer on top for orientation, I keep its line weight thin and its color a neutral gray, not black, so it doesn't compete with the choropleth for attention.

Finally, for export, I use QGIS's Layout Manager rather than exporting the map canvas directly, so I can lock in a fixed page size, add a proper legend with the Jenks break values shown as ranges, a north arrow, a scale bar, and a data source caption citing the ACS table and vintage year. I export at 300 dpi as a PNG for drafts and as an SVG when I need to hand-edit label placement, since dense tract clusters near downtown always need a couple of labels nudged by hand to avoid overlap. I save the whole QGIS project file alongside the exported figure so I can regenerate it quickly once the next ACS vintage comes out, rather than rebuilding the symbology from scratch.

## Open Issue

One thing I still haven't automated: relabeling the legend when I switch counties, since the natural breaks change every time and QGIS doesn't propagate that automatically into the layout legend text. It's a five-minute manual fix but an easy one to forget before exporting, and I've already caught myself submitting a draft figure to my advisor with a stale legend range from the previous county once, which was an embarrassing thing to have to correct after the fact.
