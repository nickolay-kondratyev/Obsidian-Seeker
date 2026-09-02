# New Website and Booking System

The current club website is a static page nobody has updated properly in two years, and event sign-ups still go through a shared spreadsheet that's produced at least one double-booking embarrassment this season already. This project replaces both with a proper website including an online booking system for events, ride sign-ups, and membership renewal, aiming to launch before next year's AGM so new members joining afterward have a modern first impression of the club rather than a page that looks abandoned.

## Requirements

The site needs a public events calendar, a members-only area for ride sign-ups and the volunteer coordination process described at [[096-annual-volunteer-coordination-meeting]], and an online membership renewal form connected to payment processing rather than the current system of cheques and bank transfers Dana has to manually reconcile every January. Kofi, who works in web development professionally, has offered to build it using a simple content management system rather than anything custom, specifically so future committee members without technical backgrounds can still update it themselves without depending on him indefinitely once he's inevitably too busy to keep maintaining it personally years down the line, which is a scenario worth planning around from the very start of the project rather than after the fact.

## Scope Decisions

A few scope questions came up early and were settled at committee before work started. Payment processing will use a standard third-party provider rather than anything built in-house, since handling card payments directly would add compliance overhead well beyond what a volunteer-run club should take on. The members-only area will use simple shared login credentials per household rather than individual accounts for every member, a deliberate simplification given how few members actually want to manage a personal password for a club website, even though it's a slight step down in security compared to individual accounts. The public events calendar will pull automatically from the same booking system rather than being maintained separately, closing off the possibility of the two falling out of sync the way the current spreadsheet and printed calendar sometimes do. Mobile responsiveness is a hard requirement, not a nice-to-have, since Kofi's early research showed most members currently check the club's social media on their phones rather than visiting the website on a laptop at all.

## Timeline

Design mockups in February, development through March and April, a closed beta with committee members in May, and a public launch in June, well ahead of the following AGM so there's time to fix any embarrassing bugs quietly before the wider membership starts relying on it for actual event bookings.

## Risks

The main risk is Kofi being the sole developer with a day job and limited spare time, which already pushed the original January launch target back to June once the real scope became clear during initial planning. Committee discussed bringing in a second volunteer developer, but nobody else in the club currently has the relevant skills, so the fallback plan if Kofi's availability changes significantly is to pause the project rather than rush something half-finished into production. There's also a data migration risk: two years of static content and the existing membership spreadsheet both need moving into the new system without losing anything, which Kofi has flagged as the part of the project he's least looking forward to tackling given how inconsistent the old records have become over time.
