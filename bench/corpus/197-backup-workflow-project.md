# Backup Workflow Rebuild

Current backup setup is one external drive plugged in sporadically, which is not really a backup system so much as a single point of failure. Prompted by a friend's drive dying last month and losing a client shoot with no recourse.

## The Problem

Right now, files live on the working laptop, get copied to one external drive "when I remember," and that's it. No offsite copy, no redundancy, no automation. If the studio flooded or the drive failed on the same day, three years of client work would be gone, including files under contracts that technically require me to retain copies for a period after delivery.

## Target Setup

Three-copy rule: working drive, local backup drive, offsite/cloud copy. Local backup runs nightly via automated software rather than manual dragging. Cloud copy uses a dedicated backup service, not general file sync, since sync tools handle version history differently and I don't want a corrupted file silently overwriting a good one across every location, which cloud sync has actually done to a colleague before, a story that convinced me to be deliberate here rather than choosing an all-purpose tool and hoping it behaved the way a real backup service would.

## Retention Policy

Active jobs, keep everything until delivery plus 90 days. After that, keep only final delivered images plus raw files for anything the client might reasonably request again, archive the rest to cold storage rather than deleting, since storage is cheap.

## Rollout Plan

Week one: buy second external drive, set up automated nightly local backup. Week two: subscribe to cloud backup service, do the initial full upload, which will take days given the total archive size at this point, several years of raw files and finished delivery folders combined across every client the studio has worked with so far.

## Testing and Documentation

Week three: test a real restore, not just trust that backups are working, actually pull a folder back down and verify it's intact and usable end to end. Week four: document the whole system in one page so Priyam or anyone else could execute a restore without me being the single point of knowledge, since that would defeat half the purpose of building this properly, and a backup nobody but me can operate isn't much of a real safety net for the business.

## Cost

Second external drive around $140, cloud backup roughly $10/month, cold storage for the archive adds maybe $4/month once populated. Total setup under $200, ongoing under $15/month, genuinely cheap relative to the cost of losing even one paid client job.
