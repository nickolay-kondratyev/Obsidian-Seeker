---
tags: [baking, sourdough, journal, spreadsheet]
created: 2026-03-10
status: active
---

Finally built the baker's percentage spreadsheet I've been meaning to make for months, tired of doing the same flour-water-salt-starter math by hand every time I want to scale a recipe up or down. The trigger was Saturday's near-disaster where I tried to scale a 500g flour recipe up to 900g in my head while distracted, mismeasured the salt, and ended up with a loaf so under-salted it tasted almost sweet by comparison. Never again, or at least not for a stupid arithmetic reason I could have avoided with five minutes of planning. Baker's percentage itself isn't complicated conceptually, everything expressed as a percentage of total flour weight, but doing it mentally while also managing a timer and a phone call from Priyam about canning swap logistics is clearly beyond me. The spreadsheet just needs flour weight as the one input, with every other ingredient calculated automatically off my usual ratios. Spent about an hour building it this afternoon, most of that time not on formulas but on the starter feeding schedule column.

## Building it

Started with a simple four-column layout: ingredient name, baker's percentage, weight in grams, and a notes column for anything unusual about that particular batch, like a lower hydration test or an added seed mix. The core formula just multiplies each ingredient's fixed percentage by the flour weight cell, so changing the one flour number recalculates everything else instantly rather than me redoing arithmetic by hand each time I want to try a new batch size. Added a separate small section below the main table for starter build timing, since that's really a separate calculation from the dough itself, backward-planned from my target mix time rather than forward from a fixed starting point like the rest of the recipe. Also built in a rounding step, since real kitchen scales don't care about baker's percentage precision past the nearest gram, and unrounded numbers were making the sheet look more precise than it actually needs to be for practical use. Color-coded the cells I actually need to touch versus the ones that are pure formula, green for editable inputs and grey for calculated outputs, mostly so future distracted-me doesn't accidentally overwrite a formula cell while rushing through a Saturday morning bake like the one that started this whole project in the first place. I also added a small validation row underneath the main table that flags if total hydration ever drifts outside my usual 65-80% comfort range, mostly as a sanity check against fat-fingering a percentage cell by accident during a rushed edit, which felt like the kind of small mistake that could easily slip past me on a busy morning otherwise, especially before coffee.

## The formula

```
flour_g       = 500              (the one input cell, everything else derives from this)
water_g       = flour_g * 0.72   (72% hydration, my current default)
salt_g        = flour_g * 0.02   (2% salt, the number I got wrong Saturday)
starter_g     = flour_g * 0.20   (20% starter, active and fed within 4-6 hours)
total_dough_g = flour_g + water_g + salt_g + starter_g
hydration_pct = (water_g + starter_g * 0.5) / flour_g   (accounts for starter's own water)
```

Simple enough to write on paper, but the point was never complexity.

## First real test

Ran a 650g flour batch through it this morning instead of my usual 500g, purely to test whether the scaling actually held up under real kitchen conditions rather than just looking right on screen. Salt came out to 13g exactly, which matched what I'd have gotten doing the math by hand carefully, a reassuring sign the formulas are right rather than just plausible-looking. Water and starter scaled cleanly too, and the dough came together with the expected feel at that hydration, slightly tacky but not sticky, matching every other 72% hydration bake I've done at the smaller 500g size. No surprises, which for a spreadsheet is exactly the outcome I wanted, though I'll keep running it alongside manual spot-checks for another few bakes before fully trusting it without double-checking. Weighed out each ingredient carefully against the sheet's numbers rather than eyeballing anything, partly to build confidence in the tool and partly out of habit after Saturday's mistake, still fresh enough in memory that I found myself double-checking the salt three separate times before actually adding it to the bowl. The starter build timing section also proved itself useful in a way I hadn't fully appreciated when building it — working backward from my planned 7pm mix time, it told me to start feeding Gustav at 1pm for a four-to-six-hour build window, and he was properly domed and passing the float test right around 6:45, close enough to trust the number going forward. Texture-wise the dough handled almost identically to a hand-calculated 500g batch scaled up before, which is really the best possible outcome for a first real test: nothing to remark on beyond everything simply working as expected, no surprises requiring troubleshooting mid-bake. I did note one small friction point, that the sheet doesn't yet account for flour absorption differences between the bread flour I usually use and the higher-protein flour Kofi lent me for this particular test, something to watch on the next few bakes before deciding whether that needs its own adjustment column.

## Next additions

Want to add a hydration slider eventually, plus a second tab for enriched doughs with butter and egg percentages, since those follow different baseline ratios entirely. Also considering a flour absorption column once I've tested a few more flour types side by side against this one, following whatever pattern emerges from Kofi's higher-protein flour test this week.
