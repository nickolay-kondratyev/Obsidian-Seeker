Reference doc for the Ledgerline Postgres schema, kept in sync with the `packages/api/migrations` folder. This is the canonical place to check column names and constraints before writing a query. See [[002-architecture-overview]] for the API layer and [[010-why-postgres-not-mongo]] for why we picked Postgres.

## organizations and users

`organizations` is the tenant root: `id` (uuid, pk), `name`, `created_at`. `users` has `id`, `org_id` (fk, not null), `email` (unique per org, not globally), `role` (`owner`, `member`), `created_at`. Every other table below carries an `org_id` column for application-layer scoping, since we don't yet enforce tenancy with Postgres row-level security — see the open question in [[020-lessons-multi-tenant-saas]].

## customers

`customers` holds the businesses our users bill: `id` (uuid, pk), `org_id`, `display_name`, `billing_email` nullable, `notes` text nullable, `created_at`, `archived_at` nullable for soft deletes. There's a composite index on `(org_id, display_name)` so the customer picker autocomplete stays fast even for organizations with a few thousand customers. We deliberately did not add a `phone` column at launch since nobody asked for it yet, and `archived_at` beats a hard delete because invoices keep a foreign key reference to the customer row long after the relationship ends.

## invoices and line items

`invoices`: `id`, `org_id`, `customer_id` (fk), `status` (`draft`, `sent`, `paid`, `void`), `issued_at` nullable, `due_at` nullable, `total_cents` (bigint), `revision_of` (fk, nullable), `created_at`. `invoice_line_items`: `id`, `invoice_id` (fk), `description`, `quantity`, `unit_price_cents` (bigint), `sort_order`. Invoices are immutable once `status` moves past `draft`; editing creates a new row via `revision_of`.

## ledger_entries

`ledger_entries` is the append-only double-entry ledger backing every money movement in the system: `id`, `org_id`, `invoice_id` nullable, `account`, `debit_cents` (bigint), `credit_cents` (bigint), `created_at`. Rows are never updated or deleted, only inserted, letting us reconstruct account balances at any point by summing. All monetary columns across the schema are stored as integer cents in a `bigint`, never a float, to avoid classic rounding-drift bugs from past projects.

## payments and jobs

`payments`: `id`, `org_id`, `invoice_id` (fk), `amount_cents` (bigint), `method` (`card`, `bank_transfer`, `manual`), `received_at`, `external_ref` nullable for the payment processor's transaction id, `created_at`. `jobs`: `id`, `kind`, `payload` (jsonb), `status` (`pending`, `running`, `done`, `failed`), `run_after`, `attempts`, `created_at`. The `jobs` table is a plain Postgres queue, no Redis or broker yet, which is fine at current volume but is worth revisiting once we're processing more than a few thousand jobs a day — see [[013-kofi-ops-journal]] for the current throughput numbers and where the ceiling probably is.

## indexes and constraints worth knowing

Foreign keys cascade on delete only for `invoice_line_items` against `invoices`; every other relationship uses `ON DELETE RESTRICT` so we never silently lose ledger history. Partial index on `invoices (org_id, status) WHERE status = 'draft'` speeds up the dashboard's draft count, which loads often.
