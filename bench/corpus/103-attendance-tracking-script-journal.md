August 3. Spent most of Sunday afternoon on a project I've been putting off for months: pulling ride data out of the club's shared tracker and into a small dashboard so we can actually see attendance trends over time instead of relying on Dana's memory and a paper sign-in sheet that half gets lost every few months. The club has used a free tracking app for years, mostly for the live-location safety feature during longer rides, but the export options are terrible and nobody had ever tried to do anything with the data beyond looking at a single ride at a time. I've been wanting an excuse to write some proper scripts again since my day job moved away from anything hands-on, and this felt like a low-stakes way to scratch that itch while actually being useful to the club rather than just a personal toy project sitting on my laptop. Started by exporting a year of ride data as CSV files, one per month, which the app at least supports even if the process of clicking through twelve separate exports was tedious enough that I nearly gave up twice before getting through all of them. The app's export button is buried three menus deep and resets the date range every time, which felt like a deliberate obstacle rather than an oversight, though I'm probably being uncharitable to whoever built it on a tight deadline. Made a coffee halfway through as a small reward for finishing month seven, which in hindsight was a fairly low bar to set for myself on a Sunday with nothing else planned.

## The Script

Once I had the raw CSVs, the actual processing was straightforward: a small Python script that reads each file, normalises the date formats, which were inconsistent between exports for reasons I never figured out, and tallies attendance by rider and by month into a single combined table. Wrote it in about an hour, tested it against a couple of months I could manually verify against my own memory of who showed up, and it matched well enough to trust for the rest.

```python
import csv
from collections import defaultdict
from pathlib import Path

attendance = defaultdict(lambda: defaultdict(int))

for path in sorted(Path('exports').glob('*.csv')):
    month = path.stem
    with open(path, newline='') as f:
        for row in csv.DictReader(f):
            rider = row['rider_name'].strip()
            attendance[rider][month] += 1

for rider, months in sorted(attendance.items()):
    total = sum(months.values())
    print(f'{rider}: {total} rides')
```

Nothing fancy, just enough to answer the questions I actually cared about: who's riding regularly, who's tapered off since spring, and whether the Saturday ride's attendance really has been climbing the way it's felt like from the saddle. Turns out it has, from an average of fourteen riders in January to twenty-two by July, which is a nice thing to have actual numbers for rather than just a vague impression. I also noticed something I hadn't expected: a cluster of six or seven riders who show up almost every single week without fail, effectively the backbone of the weekly ride, which matches the same names that keep coming up whenever the club needs a volunteer for something. I cross-checked three of those names against last year's marshal sign-up sheet just out of curiosity, and sure enough, all three had marshalled at least twice, which felt like a small confirmation that the data was actually capturing something real rather than an artefact of how the export happened to be structured. Kofi, unsurprisingly, was one of the three, given how often his name comes up in every other club document I've written recently.

## What I'll Do With This

Mostly this stays a personal curiosity for now, but the attendance cluster is genuinely useful information for the volunteer coordination work, since those regular riders are probably the best people to approach first when a ride leader slot or marshal role needs filling. I'll mention it to Tomasz next time I see him rather than trying to formalise anything just yet; a script I wrote on a Sunday afternoon isn't exactly a robust system, and I'd rather it stay a rough tool than get treated as something official before it's actually been checked properly against a full season rather than the seven months I had patience to export. There's also a fairness question worth thinking through before showing this beyond the two of us: attendance numbers don't capture people who contribute in other ways, organising events, fixing bikes, or mentoring new riders, without showing up to the weekly ride itself. I'd hate for a shiny spreadsheet to accidentally narrow how the club thinks about who's 'active,' when reality is more complicated than a simple ride count.

## Next Steps

If this proves useful I'd like to automate the export step too, though the app has no public API as far as I can tell, so that might mean scraping the web dashboard, which feels a bit fragile for something I'd want to run monthly without babysitting it every time it quietly breaks after an update. Worth checking whether a different tracking app has proper export support before investing more time here, rather than building something clever on top of a shaky foundation that could disappear the moment the app changes its layout again. For now, the CSVs and the script live in a folder on my laptop, backed up, and mostly just interesting to look at whenever curiosity strikes on a quiet evening.
