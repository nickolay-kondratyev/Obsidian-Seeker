---
tags: [roadmap, planning, ledgerline]
created: 2026-03-30
status: active
---

Q2 2026 roadmap for Ledgerline, covering April through June. This builds on the priorities that came out of [[021-quarterly-planning-q3]]'s earlier planning conversation about sequencing, even though that doc is nominally Q3-facing — a lot of the groundwork discussed there needs to land in Q2 first for the Q3 goals to even be feasible. Lotte owns this document and updates it after each planning sync; treat the table below as the current source of truth over anything said verbally in a meeting, since verbal commitments drift once a sprint starts.

## priorities this quarter

Three themes drive Q2: closing the recurring-invoices gap that came up repeatedly in [[011-client-demo-prep]] and other prospect calls, hardening the payment webhook path after the incident covered in [[016-incident-postmortem-payment-webhook]], and starting the multi-tenant row-level-security work flagged as an open question in the schema doc. Recurring invoices is the highest-confidence revenue driver of the three, based on how often it's come up unprompted in sales conversations, so it gets the most engineering time despite being the most complex to build correctly given how invoice immutability already works. Webhook hardening is smaller in scope but higher urgency, since a repeat of the November incident during a quarter with more paying customers would be materially worse for trust than it was the first time around, when we still had the excuse of being early.

## workstreams

| Workstream | Owner | Target | Status |
|---|---|---|---|
| Recurring invoices | Dana | May 15 | in progress |
| Webhook retry hardening | Kofi | Apr 10 | in progress |
| Row-level security spike | Kofi | Apr 30 | not started |
| Invoice search (basic) | Priyam | Jun 5 | not started |
| Custom branding follow-up | Lotte | Apr 20 | in progress |
| Dashboard performance pass | Priyam | Jun 20 | not started |

The webhook and branding rows are both continuations from Q1 work that slipped rather than new scope, which the team flagged explicitly so nobody reads the roadmap as evidence of scope creep. Priyam's two rows, invoice search and the dashboard performance pass, are both lower urgency and scheduled toward the back half of the quarter, so they don't compete for her attention against demo-critical payment page polish that tends to come up whenever a prospect call gets booked on short notice.

## what's explicitly out of scope

We are not building multi-currency support this quarter, since the ledger's `_cents` columns assume one currency per organization and doing this properly needs a real design pass. We're also not touching Lotte's custom-fields-on-invoices idea, referenced in [[010-why-postgres-not-mongo]], since nobody's blocked on it yet. Team-level permissions beyond owner/member are deferred too, since no pilot customer has hit that limitation.

## dependencies, sequencing, and check-ins

Row-level security needs to land before recurring invoices ships broadly, since recurring invoices will meaningfully increase the number of background jobs touching the database per organization, which raises the cost of any org-scoping bug that RLS would otherwise catch automatically. Kofi and Dana agreed to timebox the RLS spike to two weeks specifically so it doesn't silently expand and block Dana's recurring-invoices timeline, which is the larger and more customer-visible piece of work this quarter by a wide margin. We'll revisit this roadmap at the mid-quarter planning sync in early May and again during the retro closest to quarter end, adjusting target dates honestly rather than quietly sliding them, per the retro habit from [[006-sprint-retro-march]] of naming misses out loud instead of letting them go unspoken.
