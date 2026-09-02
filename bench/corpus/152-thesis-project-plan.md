# Thesis Project Plan

This plan lays out the scope of the thesis: how curb-to-platform access barriers shape who actually rides the bus in mid-size transit systems. The core claim I want to test is that sidewalk quality and stop-level accessibility explain more of the ridership gap for disabled and older riders than headway or fare policy alone. Scope is deliberately narrow — one metro area, two corridors — so the fieldwork stays doable inside two semesters. See [[151-advisor-checkin-scope]] for the scoping conversation that got me here.

## Research Questions

Three questions anchor the project. First, does self-reported difficulty reaching a stop correlate with actual boarding frequency, controlling for income and disability status? Second, do agency accessibility audits (curb cuts, tactile paving, shelter condition) predict complaint volume in 311 data? Third, when riders describe a stop as "not worth the walk," what specific built-environment features are they naming, and do those match what audits flag? I'm treating the third as the qualitative anchor that the other two quantitative questions get read against. Priyam pushed back hard on question two at our last check-in, arguing complaint volume is a noisy proxy — I'm keeping it but adding a robustness section that tests an alternate outcome, ADA paratransit substitution rates, in case the complaint data proves too sparse to say anything.

## Methods

Mixed methods, sequenced rather than parallel. Phase one is a stop-level audit of forty stops across the two study corridors, scored against a rubric adapted from Voss's accessibility framework (see [[155-reading-notes-curb-cuts]]) — curb cut presence, crossing distance, shelter, lighting, surface condition. Phase two is an intercept survey at a subset of those stops, roughly 150 completed responses, asking about trip purpose, perceived difficulty, and alternatives considered. Phase three layers in agency ridership counts and 311 complaint records at the stop level, joined by GTFS stop_id where possible and by nearest-neighbor geocoding otherwise. Analysis is a mix of descriptive comparison across audit-score tiers and a regression predicting boardings per capita from audit score, controlling for census-tract demographics and land use mix within a quarter mile. I'm treating the audit and survey as the load-bearing evidence and the regression as suggestive rather than causal — the sample size won't support strong causal claims, and I don't want the committee to think I'm overreaching there. Coding for the audit and survey happens in parallel with fieldwork so I'm not left with a six-week backlog in July.

## Milestones

Five checkpoints between now and defense, signed off by the committee:

| Milestone | Date | Status |
|---|---|---|
| Stop audit | 2026-03-20 | in progress |
| Survey fieldwork | 2026-04-30 | not started |
| Draft chapters 3-4 | 2026-06-15 | not started |
| Full draft to committee | 2026-08-01 | not started |
| Defense | 2026-09-25 | not started |

## Risks

Weather is the obvious one — intercept surveys in an exposed stop in April are miserable and low-yield if it rains for a week straight, so I've built in a two-week buffer before the hard deadline. The bigger risk is 311 data quality: earlier pulls showed huge gaps in reporting for the older corridor, which might force me to drop question two entirely rather than patch it with the paratransit proxy. There's also a scope risk that the audit rubric turns out too subjective between coders — Kofi and I need to run an inter-rater reliability check on the first ten stops before trusting the rest. If that check fails badly I'll simplify the rubric rather than train more coders, since adding people this late adds coordination cost I can't afford.
