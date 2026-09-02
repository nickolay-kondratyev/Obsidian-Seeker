**Sprint Planning — Week 1**
Date: 2026-01-12. Attendees: Dana (lead), Priyam (frontend), Kofi (backend), Lotte (product).

## Agenda

- Review backlog for the invoice PDF export feature
- Confirm Postgres migration owner for the ledger table
- Discuss [[007-database-schema-doc]] open questions
- Set sprint goal and capacity

## Discussion

Dana flagged the PDF export ticket is bigger than estimated because of font embedding. Kofi raised concerns about migration ordering on `ledger_entries`, since two features touch it this sprint. Lotte asked if export could ship without custom branding first; the team agreed.

## Decisions

- Sprint goal: ship invoice PDF export (plain template) and finish the `ledger_entries` migration.
- Custom branding on PDFs is deferred to next sprint; Lotte will write the follow-up ticket.
- Kofi owns migration ordering and will pair with Dana on Tuesday morning before touching production schema.
- Priyam takes the export UI, Dana takes the PDF renderer service.

## Action Items

- [ ] Dana: draft PDF renderer service interface by Wednesday, share in `#ledgerline-eng`
- [ ] Kofi: write migration plan doc and post it before running anything against staging
- [ ] Priyam: build export button and loading state in the invoice detail view
- [ ] Lotte: write branding follow-up ticket and rough sketch of logo placement
- [ ] Dana: confirm font licensing for the default invoice template is fine for commercial use
- [ ] All: flag blockers in standup rather than waiting until Friday

## Next Meeting

Retro and demo scheduled for next Friday at 10:00. Kofi will demo the migration tooling if it lands in time, otherwise that part moves to the following review.
