---
tags: [zoning, history, article, thesis]
created: 2026-03-01
status: draft
---

Exclusionary zoning in the United States is usually dated to a 1916 New York ordinance and its imitators, but the more interesting history is the century of failed and half-successful attempts to unwind it. Most accounts of zoning reform treat the last decade's wave of state-level upzoning laws as a novel phenomenon, a response to the housing-cost crisis unique to this moment. That framing flatters the present at the expense of the past. Reform attempts date back at least to the 1970s, when court challenges and model-code proposals tried to strike down single-family-only districts on fair-housing grounds, and nearly all failed or stalled. Understanding why they failed is more useful than understanding why the original ordinances were adopted, because the failure modes repeat with remarkable consistency: a reform passes at the state level, faces litigation or a ballot referendum locally, and either dies in implementation or survives only in a watered-down form preserving most of the exclusionary effect.

The pattern is clearest in the fair-share housing litigation of the 1970s and 1980s. A landmark state supreme court ruling required municipalities to zone for a "fair share" of regional affordable housing need, a direct assault on exclusionary practice in principle. In practice, the ruling triggered nearly two decades of follow-up litigation as municipalities complied only nominally — zoning tiny parcels on floodplains or adjacent to highways, technically meeting the letter of the ruling while ensuring nothing would get built. Voss calls this "paper compliance," a distinct reform failure mode, separate from outright rejection, because it is harder to litigate against and easier for officials to defend publicly. This distinction matters for evaluating the current wave of reforms, which relies on similar top-down mandates.

What makes the last decade's reforms different, tentatively, is enforcement design, not political will. States that paired upzoning mandates with builder's remedies — provisions letting developers bypass local review if a municipality fails to comply — saw meaningfully higher build rates than states relying on mandates alone. That's the strongest evidence so far for the article's central claim: reform succeeds not when it changes what zoning says but when it removes the discretion that let municipalities comply on paper while resisting in practice.

## The Referendum Problem

Even well-designed state mandates remain vulnerable to a second failure mode: the local ballot referendum. Several cities that complied with state upzoning law saw citizen initiatives attempt to repeal the local implementing ordinance within a year, often funded by neighborhood associations invoking traffic and "character" concerns rather than explicit exclusionary language. Adeyemi's comparative work on this period finds referendum campaigns succeeded roughly twice as often in municipalities without an existing tenant-organizing infrastructure, suggesting organized opposition on the pro-housing side is not optional — it's a structural requirement for reform to stick, not something that follows automatically once a mandate passes. Municipalities that lost referendum fights almost always lacked any standing coalition ready to defend the ordinance once the signature-gathering started, which meant the fight was lost in the six weeks after passage, long before the actual vote.

## Data and Method

For this section I pulled reform-outcome data for eleven cities that adopted state-mandated upzoning between 2019 and 2024, coding each on enforcement mechanism, referendum challenge, and permit growth in the following two years. Sourcing was mostly local news archives and permit dashboards, cross-checked against Adeyemi's dataset where the two overlapped, which was only about half the cities — the other half I had to build from scratch by hand, which took most of a week longer than I budgeted for. I used a small script against a local Postgres copy of the data to tabulate outcomes by enforcement-design variable before writing up the comparison, since the raw spreadsheet was too unwieldy to eyeball reliably once it had more than a handful of columns:

```sql
select
    city,
    enforcement_mechanism,
    referendum_challenge,
    round(avg(permit_growth_pct), 1) as avg_permit_growth
from reform_outcomes
where reform_year between 2019 and 2024
group by city, enforcement_mechanism, referendum_challenge
order by avg_permit_growth desc;
```

The output isn't a clean causal story — eleven cities is not a sample, it's an illustration — but the ranking held up under every reasonable re-sort I tried.

## What the Ranking Shows

Cities with a builder's remedy and no successful referendum challenge clustered at the top of permit growth, unsurprisingly. More interesting is the middle of the ranking: cities with a builder's remedy that *did* face a referendum still outperformed cities with mandates but no remedy at all, even when the referendum ultimately succeeded in rolling back part of the ordinance. That suggests the remedy provision does real work even under political attack, possibly because it front-loads permit applications before a repeal can take effect, banking permitted projects that quietly survive the later rollback intact.

The bottom of the ranking is just as telling as the top. Cities with mandates but no remedy and no organized referendum defense saw permit growth barely distinguishable from cities that never adopted a state mandate at all, which is the closest thing to a null result this small sample can produce, and it lines up uncomfortably well with the "paper compliance" pattern from the 1970s fair-share cases. The mechanism looks different on the surface — litigation delay versus referendum rollback — but the underlying dynamic is the same: without something that forces action independent of continued local political will, the mandate becomes a formality rather than a constraint. I keep returning to that phrase, "paper compliance," because every version of this pattern I find across five decades of reform attempts seems to be some variation on it, dressed in different procedural clothing.

## Limits and Why This Matters Now

Eleven cities and no demand controls make this illustrative, not the dissertation's empirical core — see [[157-literature-review-project]] for the fuller design. Still, the century-long pattern suggests reforms outlast the political moment only when enforcement keeps improving. Compare [[170-long-article-transit-equity]].
