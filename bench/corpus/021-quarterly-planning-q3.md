---
tags: [planning, meeting, roadmap]
aliases: [Q3 Planning]
created: 2026-03-02
status: active
---

Attendees: Dana, Priyam, Kofi, Lotte. Date: 2026-03-02. Purpose: set Q3 priorities together.

## Context

Q2 shipped invoice revisions and the staging deploy pipeline. Q3 needs to address reliability gaps surfaced by the payment webhook incident and prepare for the first real customer growth push.

## Candidate priorities

Job queue reliability carries over directly from [[016-incident-postmortem-payment-webhook]]. Row-level security for `org_id` scoping, discussed in [[020-lessons-multi-tenant-saas]], competes for the same backend time. Priyam raised the revision-history confusion from [[018-lotte-design-journal]] as a smaller, quicker win to pursue.

## Discussion

Kofi argued job queue work should be first since it's tied to an actual incident, not a hypothetical risk. Dana agreed but flagged that row-level security keeps getting deferred every quarter without the gap shrinking. Lotte pushed for the revision-history explainer to ship early regardless, since it's small and already has a design direction ready. No one disagreed.

## Decisions

Q3 priority order: job queue reliability first, since it's the only item tied to a real incident rather than a hypothetical gap. Revision-history explainer ships early and in parallel, since it doesn't block on anything else and Priyam already has a design direction from Lotte ready to implement. Row-level security is deferred again for the fourth consecutive quarter, but with a written commitment to revisit it at Q4 planning rather than letting it slide silently, since Dana was clear that indefinite deferral isn't an acceptable answer to a real architectural gap.

## Action items

- [ ] Kofi: scope job queue work by 2026-03-09.
- [ ] Priyam: ship revision-history explainer by end of March.
- [ ] Dana: write row-level security plan.
