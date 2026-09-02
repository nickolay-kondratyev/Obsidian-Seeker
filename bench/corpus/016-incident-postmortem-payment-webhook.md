---
tags: [incident, postmortem, payments]
aliases: [Payment Webhook Postmortem]
created: 2026-02-11
status: done
---

Attendees: Dana (backend lead, facilitator), Kofi (devops/backend), Priyam (frontend), Lotte (product/design, observer).

Date: 2026-02-10, incident window 14:02-15:47 UTC. Severity: Sev-2. Related notes: [[026-debug-session-webhook-retries]], [[007-database-schema-doc]].

Purpose of this meeting: agree on a shared timeline, agree on root cause, and assign follow-up action items before anyone starts writing code. Dana opened by reminding everyone this is blameless — the goal is fixing the system, not finding who to blame. She also asked that nobody propose fixes until the timeline and root cause sections were fully agreed on, since jumping straight to solutions has derailed past postmortems before the group had established what actually happened. Kofi took notes directly in this document during the call, so the timeline below reflects what was reconstructed live from logs and the deploy history.

## Timeline

14:02 UTC — payment provider's webhook delivery started failing intermittently against our `/webhooks/payments` endpoint, though nobody noticed yet because our alerting only fires on a five-minute sustained error rate, not brief spikes.

14:19 UTC — the sustained-error alert fired in the ops channel. Kofi acknowledged it within two minutes and started looking at the API logs, initially suspecting a deploy that had gone out around 13:50.

14:31 UTC — Kofi ruled out the deploy; error signatures didn't match anything in the diff. He noticed the `jobs` table had a growing backlog of `payment_webhook_retry` rows stuck in `pending` status, which was the first real clue something structural was wrong rather than a transient blip.

14:48 UTC — Dana joined the incident channel and pulled up the webhook handler code directly. She found that a recent schema change to the `payments` table (shipped two days earlier) had added a `NOT NULL` constraint on `provider_reference` without a matching default, and a subset of retried webhook payloads from the provider omitted that field on retry attempts specifically, which the original code path had never hit in testing.

15:05 UTC — root cause confirmed: any retried webhook missing `provider_reference` was failing the insert, throwing, and getting re-queued into `jobs`, which meant retries were retrying forever and consuming worker capacity without ever succeeding, effectively starving other job types.

15:20 UTC — Kofi shipped a hotfix migration making the column nullable temporarily and deployed a patched handler that backfills a placeholder reference when the provider omits one, flagging those rows for manual reconciliation.

15:47 UTC — backlog drained, alert cleared, incident closed.

## Root cause

Two failures compounded. First, the migration that added the `NOT NULL` constraint on `payments.provider_reference` was reviewed and merged without anyone checking what the provider's retry payloads actually look like in production — the assumption was that every webhook delivery, including retries, always includes that field, which turned out to be true for first deliveries but not guaranteed for retries after a timeout. The migration passed review because the reviewer, like the author, was reasoning from the provider's documented payload schema rather than from observed production traffic, and the documentation simply doesn't mention that retries can omit optional fields present on the original delivery. Second, and more damaging, the retry logic in the `jobs` worker had no maximum attempt count and no dead-letter handling, so a permanently-failing job just kept consuming a worker slot and retrying every thirty seconds indefinitely instead of failing loudly after a bounded number of attempts. This meant the very first failed webhook, at 14:02, set off a retry loop that silently occupied worker capacity for the next forty-five minutes without ever producing an alert of its own — the only reason anyone noticed was the downstream sustained-error-rate alert on the endpoint, not anything from the queue itself. Either failure alone would have been a minor annoyance; together they turned a data assumption bug into forty-five minutes of degraded payment processing with no automatic recovery path. Lotte asked whether customers were affected directly — Dana confirmed no payments were lost and no data was corrupted, but confirmation emails to a handful of customers were delayed by up to an hour, which is itself worth a short customer-facing note even though nobody has complained about it yet as of this meeting. Kofi added that the worker slot starvation likely also delayed unrelated background jobs during that same window, including scheduled report generation, though nobody had confirmed that with hard numbers before the meeting and it was flagged as worth checking in the follow-up rather than asserted as fact here.

## Discussion

Kofi raised that this is at least the second incident this quarter traceable to a schema constraint being added without checking real-world payload variance, and suggested the review checklist in [[029-pr-review-guide]] should explicitly call out `NOT NULL` additions on any table touched by external webhook data. Dana agreed and added it as an action item rather than trying to write the checklist language live in the meeting.

The bigger conversation was about the job queue itself. Everyone agreed the lack of a max-attempt limit and dead-letter table is a real gap, not just a one-off bug, and that it's been tolerable so far only because Ledgerline hasn't had a sustained failure mode like this before. Kofi was hesitant to reach for a broker like Redis-backed queueing, arguing the plain `jobs` table has been fine and the fix is a bounded retry count plus a `failed` status, not a rewrite. Priyam asked whether the frontend needs to surface anything about delayed webhook processing to users, and the answer was no for now since nothing is customer-visible beyond the delayed confirmation emails, but it's worth keeping in mind if incidents like this recur with a more visible symptom. Dana asked Kofi to at least sketch what a dead-letter table would look like schema-wise before committing to the bounded-retry-only approach, just so the option is documented even if not built yet. Lotte noted this should feed into the reliability discussion already planned for [[021-quarterly-planning-q3]], and volunteered to make sure it doesn't get dropped from that agenda given how easy backlog reliability work is to deprioritize against customer-facing feature work.

## Action items

- [ ] Kofi: add max-attempt count (5) and a `failed` status with dead-letter handling to the `jobs` worker, target 2026-02-17, plus a short design sketch of the dead-letter table schema for the record even if it doesn't ship this round.
- [ ] Dana: add schema-review checklist item for `NOT NULL` constraints on webhook-adjacent tables in [[029-pr-review-guide]], explicitly calling out retry payloads as distinct from first-delivery payloads.
- [ ] Kofi: revert the temporary nullable `provider_reference` once retry backfill logic ships properly, not just the hotfix, and confirm the placeholder-flagged rows have all been reconciled manually.
- [ ] Dana: draft short internal note on customer email delay for support to reference if anyone asks, even though no one has yet.
- [ ] Lotte: bring job-queue reliability gap into Q3 planning as a candidate priority and make sure it isn't silently dropped in favor of feature work.
- [ ] Priyam: keep an eye out for any future incident where delayed webhook processing does become customer-visible on the frontend.
