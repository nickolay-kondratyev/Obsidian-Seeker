A proofing box holding a stable 78-82F solves most of my winter fermentation problems, from sluggish sourdough to yogurt that never sets. This is the build I landed on after two failed attempts with towels and a heating pad, using a used mini fridge, a cheap temperature controller, and a lightbulb as the heat source instead of anything more exotic.

## Building the box

Start with a mini fridge, ideally a used one from a local listing — mine cost $45 and still had a working compressor, which matters because we're wiring around the thermostat rather than the cooling system itself. The trick with any fridge-based proofing box is that you're not using the fridge to cool anything; you're using its insulated, roughly airtight cabinet as a stable enclosure and adding your own heat source and thermostat. Unplug the fridge itself and leave the compressor alone entirely, since it will never run in this setup.

Inside the cabinet, mount a simple ceramic heat emitter or a low-wattage incandescent bulb in a socket with a metal reflector behind it, positioned away from anything plastic so it can't melt or scorch a shelf. A 25-40 watt bulb is plenty for a mini-fridge-sized cabinet; anything bigger risks overshooting the target range faster than the controller can react. Drill a small hole in the back or side for the temperature probe cable and another for the bulb's power cord, then seal around both with a bit of silicone to keep the cabinet reasonably airtight without trapping condensation.

The controller is the part that actually makes this reliable instead of a fire hazard. I used an off-the-shelf inkbird-style temperature controller, which sits between the wall outlet and the bulb, reading a probe placed inside the cabinet and switching the bulb on and off to hold a target range. Set the target to 80F with a swing of about 2 degrees in each direction, meaning the bulb kicks on below 78 and cuts off above 82. Tape the probe to the inside wall of the fridge, not touching metal shelving directly, since direct contact with the shelf can give a colder reading than the actual air temperature around your dough.

> [!tip] Probe placement matters more than wattage
> A probe taped near the door reads several degrees cooler than the center of the cabinet. Center it at roughly the height where your bowls or jars will actually sit, not wherever is convenient to reach.

Once wired, I ran it empty for 24 hours to check for stable cycling before trusting it with actual dough. The log below is a simplified version of the readings I took every fifteen minutes with a separate independent thermometer, just to confirm the controller's own display wasn't lying to me:

```
time      controller_read  independent_read  bulb_state
08:00     79.8F            80.1F             off
08:15     78.6F            79.0F             off
08:30     77.9F            78.2F             on
08:45     79.4F            79.6F             on
09:00     80.9F            81.0F             off
09:15     81.6F            81.8F             off
09:30     80.2F            80.4F             off
09:45     78.4F            78.7F             on
```

The two readings tracked closely enough — within half a degree — that I trusted the built-in probe going forward and stopped running the independent thermometer every time. One thing I didn't expect: the bulb cycles roughly every 20-25 minutes once the cabinet reaches equilibrium, which is more frequent than I'd assumed and means the bulb's lifespan is a real consideration, not just its wattage. I've gone through two bulbs in three months of near-daily use, which is a minor but real ongoing cost worth budgeting for if you're building this for the long haul rather than a one-off experiment. It's also worth noting that ambient room temperature shifts the cycling frequency more than I expected; on colder nights the bulb runs almost continuously, while on a mild afternoon with the kitchen already warm it barely kicks on at all, which matters if you're trying to estimate bulb lifespan from a single week of observation rather than a full season. I'd originally assumed the cabinet's insulation would smooth most of that variation out, but a mini fridge is not built to retain heat the way it's built to retain cold, so the swing between a cold January night and a mild March afternoon is bigger than I expected going in.

## Results after a month

Sourdough proofs in roughly half the time it used to take on the counter, and the crumb has been more even across three test bakes since the box went live. Yogurt now sets reliably overnight instead of the coin-flip it used to be. For safety, I keep a smoke detector mounted above the box and never leave the house with it running unattended during the first few days of a new build. See [[122-bakery-equipment-upgrade-project]] for the wider proofing project this build feeds into.
