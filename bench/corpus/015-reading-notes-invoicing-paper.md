---
tags: [reading, invoicing, research]
aliases: [Invoicing Paper Notes]
created: 2026-01-19
status: done
---

## Source

"Ledger Semantics for Small Business Accounting," a paper Dana found while researching immutability for [[017-api-design-doc]].

## Core claim

Once a financial document is transmitted to a counterparty, it must never be silently mutated again.

## Why it matters here

This is basically the argument for why Ledgerline treats a sent invoice as frozen and requires a new draft revision for any change made afterward, rather than editing in place.

## Relevant section

Section 4, "Append-only representations," covers this directly and in detail, pages 61-68 in the printed edition.

## The phantom edit problem

The paper describes a failure mode where a customer sees invoice totals differing from what their accountant received, because the system allowed in-place edits after sending, so two people looking at "the same" invoice see different numbers with no trail explaining why.

## My takeaway

Append-only ledger entries plus revisioned invoices give us both properties for free: the ledger is a true history, each revision an honest snapshot of what a customer actually saw.

## Open question

Does this reasoning extend to draft-stage invoices too, or only ones already sent to a customer?
