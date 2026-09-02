# API design doc

This is the reference for how the Ledgerline API is shaped: REST conventions, error responses, pagination, versioning, and auth. It complements [[007-database-schema-doc]], which covers table structure — this doc covers what clients actually see over HTTP on port 4000.

## REST conventions

Resources are plural nouns: `/invoices`, `/customers`, `/ledger-entries`. Standard verbs only — `GET`, `POST`, `PATCH`, `DELETE` — no verb-shaped endpoints like `/invoices/send`. Sending an invoice is `POST /invoices/:id/send`, treating "send" as a sub-resource action rather than a custom verb, which keeps the routing table predictable. `PATCH` never applies to a sent invoice; the handler rejects it and expects a new draft revision instead.

## Error response shape

Every error returns a consistent JSON body: `{ "error": { "code": "string", "message": "human-readable", "details": {} } }`, always with a matching 4xx or 5xx HTTP status. `code` is a stable machine-readable string like `invoice_already_sent` that clients can branch on; `message` is for logs and debugging, not for showing users directly, since [[008-priyam-frontend-refactor-journal]] covers why we stopped rendering raw API messages in the UI. `details` carries field-level validation errors when relevant, keyed by field name so the frontend can attach messages to the right form input without string matching.

## Pagination

All list endpoints use cursor-based pagination, not offset. Requests take `?cursor=<opaque>&limit=<n>`, default limit 25, hard cap 100. Responses include `next_cursor: string | null`. Chosen over offsets because `ledger_entries` grows fast enough that offset pagination drifts under concurrent writes.

## Versioning

No `/v1/` prefix yet — the API is unversioned because we control every client (the web app in `packages/web` and nothing external) and can coordinate breaking changes as a single deploy. This is a deliberate deferral, not an oversight, and it gets revisited the moment a third-party integration exists, since coordinated deploys stop being an option once someone else's code depends on our response shape.

## Authentication

Auth is session-cookie based, issued at login and validated on every request by Express middleware before the handler runs. There's no API-key or OAuth flow yet since Ledgerline has no public API surface. `org_id` scoping happens inside each handler after auth resolves the session to a user, then that user to their org — see [[010-why-postgres-not-mongo]] for why this is application-layer rather than row-level security today. Every handler filters by `org_id` explicitly; nothing is implicit or inherited from a shared base query.

## Open questions

Should `org_id` scoping move into Postgres row-level security before a second untrusted client exists? Does an unversioned API survive contact with a future public integration, or does deferring versioning just move the pain further down the road?
