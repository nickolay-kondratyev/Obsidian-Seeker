---
tags: [project, finance, automation, spreadsheet]
created: 2026-02-10
status: active
---
# Personal finance tracker automation

Our spreadsheet has grown into something genuinely useful over three years, but pulling transaction data in manually every week had become the weekly chore neither of us wanted to own. This project automates the import step using a small script against our bank's CSV export, so the weekly [[211-budget-review-sync]] starts from clean numbers instead of an hour of manual entry we kept putting off until Sunday night, right before the meeting itself, which defeated half the point of having a system in the first place.

## Goal and scope

Pull weekly CSV exports from checking and the two credit cards, categorize transactions automatically using a rules file we maintain ourselves, and drop the result into a staging sheet the main budget spreadsheet reads from via a simple import formula. Explicitly out of scope for this first pass: investment account syncing, since brokerage exports are messier and less standardized, and any kind of bank API integration, since we don't want to hand out credentials to a third-party aggregator for something this small. Manual CSV export and a local script felt like the right level of complexity for two people, not a startup-grade finance stack we'd have to maintain forever just to save twenty minutes a week.

## How it works

The script reads a CSV, matches merchant strings against a rules file of regex patterns mapped to budget categories, flags anything unmatched for manual review instead of guessing, and writes a clean output CSV that gets pasted into the staging sheet. Roughly 90% of transactions match automatically now that the rules file has matured over six weeks of real use; the rest get five minutes of manual categorization each week, down from the full hour we used to spend before this existed. The staging sheet keeps a running log of unmatched merchants too, which turned out to be a useful side effect: it's basically a live list of every new vendor we've started spending money with, sorted by how often they show up, which is its own small piece of insight we hadn't planned for going in.

```python
import csv, re

RULES = {
    r"WHOLEFDS|TRADER JOE": "groceries",
    r"SHELL|CHEVRON|EXXON": "gas",
    r"NETFLIX|SPOTIFY": "subscriptions",
}

def categorize(desc):
    for pattern, category in RULES.items():
        if re.search(pattern, desc, re.I):
            return category
    return "UNMATCHED"

with open("export.csv") as f, open("staged.csv", "w", newline="") as out:
    reader = csv.DictReader(f)
    writer = csv.writer(out)
    for row in reader:
        writer.writerow([row["date"], row["amount"], categorize(row["description"])])
```

## Status

Working and in weekly use since mid-March. Rules file currently has 34 patterns covering our recurring merchants, expanded gradually as new unmatched transactions show up rather than anticipating everything up front. Runtime is under a second for a typical week of transactions, genuinely a non-event to run, which matters for whether it gets used consistently rather than skipped on a busy Sunday.

## Next steps

Add a small check that flags transactions over $200 for a second look regardless of category match, since large one-off purchases matter more to catch than routine ones. Also want to add a simple monthly summary output so quarterly reviews like the ones tracked in [[226-fire-meetup-quarterly-checkin]] pull straight from generated numbers instead of a manual spreadsheet formula that occasionally breaks when a category gets renamed and nobody notices for a month. Longer term, if the manual credit card CSV export ever becomes annoying enough, we might revisit the API integration question, but only with a provider that has a genuinely good security track record and only after reading the terms closely rather than clicking through them the way most people do.
