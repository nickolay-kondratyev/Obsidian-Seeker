---
tags: [workshop, electrical, project]
status: active
created: 2026-04-20
---

# Workshop Electrical Plan

This document lays out the electrical scope for the detached workshop, following up on the questions raised at the [[036-permit-office-meeting]]. It covers the subpanel sizing, circuit list, and the tools each circuit needs to support, since the original 100-amp guess turned out to be exactly that, a guess, rather than anything backed by an actual load calculation from the electrician who's now doing that math properly before we resubmit the workshop permit application to the county's review queue.

## Load Calculation Inputs

The load calc needs to account for everything that might run simultaneously, not just everything that could theoretically be plugged in at once, since code allows some diversity factor for tools that rarely run together. Major loads: a 5-horsepower table saw with a soft-start feature, a two-stage dust collector rated at 3 horsepower, a 240-volt welder that draws heavily but runs infrequently and briefly, a space heater for winter use, a compressor, and general lighting and outlet circuits throughout the roughly 400-square-foot structure. The electrician is treating the welder and the space heater as mutually exclusive in practice, since nobody welds while heating the whole room, which meaningfully reduces the peak demand calculation compared to a naive sum of every device's nameplate rating.

## Circuit List

The plan currently proposes twelve circuits total, covering the table saw and dust collector each on their own dedicated 240-volt run, the welder on a separate 240-volt circuit with a NEMA 6-50 outlet, general 120-volt outlets split across three circuits so a single tripped breaker doesn't kill the whole room, dedicated lighting on its own circuit separate from any outlets so a shop-vac doesn't take out the lights mid-project, and the space heater on its own 240-volt circuit given how much continuous draw a good heater pulls through a full winter. A small subpanel houses all of this, fed by a single larger run from the house's main panel out to the workshop, buried per code depth requirements along a route the electrician has already flagged with the excavator doing the trenching work. The compressor gets its own 120-volt circuit too, separate from general outlets, since it cycles unpredictably and we'd rather not have it competing with anything else mid-cut. Every circuit is labeled clearly at the subpanel, something the electrician insisted on after seeing too many mislabeled panels in older shops he's rewired.

## Lighting Plan

Lighting is LED shop fixtures on their own circuit, roughly eight fixtures for even coverage, plus a dedicated outlet near the future workbench for task lighting that can be repositioned as the layout evolves. A separate switch handles the exterior light over the workshop door, tied to the same circuit as general lighting rather than a new one entirely.

## Open Items

Still waiting on the final amperage number from the load calc, which determines whether we need a 100-amp or 125-amp subpanel, and on the surveyor's setback confirmation before final permit resubmission, both discussed at length in the permit meeting notes above. Also unresolved: whether the trenching route can avoid the old apple tree's root zone entirely, since Lotte flagged during a garden walkthrough that cutting through major roots there could stress the tree we're specifically trying to preserve as part of the redesign, and the electrician is now working out an alternate route around it that adds roughly fifteen feet to the run but avoids that risk entirely, at a modest added trenching cost we'll fold into contingency.
