Prep meeting for Thursday's demo with a prospective landscaping business evaluating us against two competitors.

## attendees

Dana, Priyam, Lotte. Kofi joined for the first ten minutes to confirm [[009-deploy-to-staging]] was green before the rest of the agenda started.

## agenda

Walk through the demo script end to end, assign who drives which section, and agree on a fallback plan if the live environment hiccups during the call. Lotte wants to time-box the whole thing to twenty-five minutes, since the prospect only booked thirty minutes.

## decisions

Agreed to demo against staging, not production, so a bad query can't visibly break the call in front of the prospect. Dana will seed staging with realistic landscaping-business data — mowing, mulch delivery, seasonal cleanup — the night before rather than generic test fixtures. Lotte flagged that recurring invoices already came up; the team agreed to point at [[012-roadmap-q2]] rather than overpromise a date.

## demo script and action items

Priyam drives the customer-facing payment page since that's likely to draw questions about processing fees, while Lotte closes with the dashboard and handles pricing, since she knows where we're flexible on the quarterly plan.

- [ ] Dana: seed staging with landscaping-business demo data by Wednesday evening
- [ ] Priyam: verify the payment page renders on the prospect's older Safari version, per [[028-priyam-performance-tuning-journal]]
- [ ] Lotte: prep a one-pager on pricing tiers to share after the call

## risks

Biggest risk flagged was the recurring-invoices gap turning into a hard blocker rather than a soft objection; Lotte will read the room and offer a manual workaround if needed.
