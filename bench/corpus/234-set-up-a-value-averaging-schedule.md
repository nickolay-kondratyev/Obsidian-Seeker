---
tags: [finance, investing, how-to]
created: 2026-02-11
status: active
---

I switched our brokerage contributions from a flat dollar-cost-average to a value-averaging schedule last quarter, after Priyam kept mentioning it worked well during her own accumulation years and pushed harder than usual for me to actually try it. This is the setup I actually used, not the textbook version, so future-me can redo it without relearning the math from scratch every time.

## Setting it up in a spreadsheet

Value averaging means you set a target portfolio value for each future month, then buy or sell whatever amount closes the gap between that target and the actual balance — instead of contributing the same fixed amount every month regardless of how the market moved. The appeal is that it naturally buys more when prices are down and less (or nothing, or sells a little) when prices are up, which is the opposite of what my instincts usually want to do.

Start with a target growth path. I picked a target monthly increase of $900, which is roughly what a flat dollar-cost-average contribution would have been, so the two strategies are comparable. Row one of the spreadsheet is month zero with a target value of zero. Row two's target is $900. Row three's target is $1,800. And so on — the target column is just a running multiple of the monthly increase, nothing fancier.

Each month I look at the actual account balance after any market movement, subtract it from that month's target, and the difference is what I contribute. If the market had a bad month and the account is below target, the difference is larger than $900 and I contribute more than usual. If the market had a strong month and the account is already above target, the difference is smaller, sometimes even negative, and I contribute less or, in a couple of cases this year, nothing at all.

The part that trips people up, and tripped me up the first two months, is remembering that the target keeps climbing by a fixed amount regardless of what the market did, so a genuinely bad quarter can call for contributions well above what a flat budget assumes. I built in a rule for myself: if a single month's calculated contribution would exceed 1.5 times the normal $900, I cap it at that and roll the remainder into the following month instead of draining the checking account in one shot. That cap has only triggered twice, both during the spring pullback, but it kept me from panic-overfunding in a way that would have messed up our regular budget.

I also had to decide what to do about the theoretical "sell" months, where the actual balance already exceeds the target and the formula says to withdraw. My rule there is simpler: I never actually sell, I just contribute zero that month and let the surplus carry forward implicitly. Purists will say this breaks the strict value-averaging model, and it does, but I'm not interested in triggering capital gains just to satisfy a spreadsheet formula, and the difference in long-run outcome is small compared to the discipline benefit of having a rule at all.

The spreadsheet itself is four columns: month, target value, actual balance (pulled manually from the brokerage app on the first of each month), and contribution (a simple subtraction formula with the cap and floor rules layered on as an `IF` statement). I keep a running note column too, mostly so I remember why a given month looked unusual six months later when I'm scanning back through it.

One thing I didn't expect: this system made the emotionally hard months, the ones where the market was down and everything felt bad, into the months where I was mechanically required to invest the most. That reframing has done more for my anxiety about market drops than any amount of reading about long-term averages ever did, because the spreadsheet just tells me what to do and I don't have to trust my own judgment in the moment.

## Caveats before you copy this

This only works if your monthly budget has enough slack to absorb the capped 1.5x months without going into debt — if your contribution budget is already tight, a flat dollar-cost-average is safer. It also assumes you're disciplined enough to actually pull the real balance each month rather than fudging it; I set a recurring calendar reminder for the first because I know myself. See [[214-build-a-zero-based-budget]] for how the contribution line fits into the broader monthly budget this depends on.
