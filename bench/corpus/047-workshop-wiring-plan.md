# Workshop Wiring Reference

Quick reference doc pulling the final numbers out of [[042-workshop-electrical-plan]] once the load calc and permit resubmission both landed, so the electrician has one clean sheet to work from on installation day rather than the scattered notes from planning.

## Final Amperage

The load calculation came back at 87 amps continuous, which the electrician rounded up to a 100-amp subpanel rather than the larger 125-amp option, since the headroom above 87 was judged sufficient. This resolved the open question flagged at the permit office meeting, where the original figure had just been a guess.

## Circuit Table

| Circuit | Amps | Voltage | Load |
| --- | --- | --- | --- |
| 1 | 20 | 240 | Table saw |
| 2 | 20 | 240 | Dust collector |
| 3 | 50 | 240 | Welder |
| 4 | 20 | 240 | Space heater |
| 5-7 | 20 each | 120 | General outlets |
| 8 | 15 | 120 | Lighting |
| 9 | 20 | 120 | Compressor |

## Panel Schedule Notes

Circuits 5 through 7 split the general outlets around the room's perimeter so no single wall depends on one breaker. The electrician left two open slots in the subpanel for anything added later, cheaper to reserve now than swap the panel down the line.

## Trenching Route

```yaml
trench:
  start: main_panel_house
  end: workshop_subpanel
  depth_inches: 24
  route: "around apple tree root zone, +15ft"
  conduit: PVC schedule 40
  wire: 4 AWG copper, 3 conductor + ground
```

This routes around the apple tree's root zone per the landscaper's request, adding roughly fifteen feet to the run but avoiding any risk to the tree we're specifically trying to keep healthy through the whole garden redesign.

## Inspection and Cost Summary

Before the rough-in inspection, confirm the trench depth meets the 24-inch code minimum, verify the panel labeling matches the circuit table above exactly, and double check the welder receptacle is the correct NEMA 6-50 configuration rather than a mismatched substitute. Total electrical cost, including the rerouted trench, came in at forty-two hundred dollars, roughly three hundred over the original estimate, mostly from the added trenching length around the apple tree and the two reserved panel slots for future expansion.

## Sign-Off

Both the electrician and Kofi signed off on this final version before ordering materials, and a copy went to the permit reviewer alongside the resubmitted workshop application this week, closing out one of the last open items from the original permit meeting.
