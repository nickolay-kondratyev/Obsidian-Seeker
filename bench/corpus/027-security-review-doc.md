---
tags: [security, review, ledgerline]
created: 2026-04-30
status: done
---

Findings from the internal security review Kofi ran ahead of our first enterprise customer's procurement checklist, covering authentication, data isolation, and dependency hygiene. Not a formal third-party audit, but thorough enough to surface real gaps before anyone signs a contract referencing it.

## Authentication findings

Sessions use httpOnly JWT cookies with reasonable expiry, no findings there. One real gap: password reset tokens didn't expire until used, rather than after a fixed window, meaning an old unused reset link stayed valid indefinitely for as long as nobody clicked it. Fixed same day with a 30-minute expiry, tracked in [[017-api-design-doc]]'s auth section for the record.

## Data isolation findings

The biggest open item, already known internally: `org_id` scoping happens entirely at the application layer, described in [[002-architecture-overview]], with no Postgres row-level security as a backstop. A bug in any single query could leak cross-organization data. We audited every query touching customer or invoice tables by hand and found none currently missing the filter, but "audited by hand" is not a durable guarantee going forward as the codebase grows, and this is the finding the review treats as highest priority to address structurally rather than patch individually each time.

## Dependency findings

`npm audit` (via `pnpm audit`) showed two moderate transitive vulnerabilities in dev-only tooling never shipped to production, and one low-severity issue in a production dependency with no known exploit path. All three patched within the week.

## Secrets and logging findings

No secrets are committed to the repository; a pre-commit hook using `gitleaks` blocks anything matching common credential patterns. Production secrets live in the provider's encrypted environment store, never in `.env` files, per [[004-local-dev-setup]]. Separately, application logs were reviewed for leakage: one debug line printed the full request body on failed validation, occasionally including a payment reference number. Removed; replaced with a redacted field-name summary only.

## Recommendations and priority

Ranked by the team: row-level security as defense-in-depth is the highest-value structural fix, tracked as a follow-up ticket Kofi owns and has already scoped roughly with Dana's input. Dependency patching is now a standing biweekly task rather than purely reactive. The reset-token and logging fixes already shipped this week. None of these findings block the current enterprise conversation, but the row-level security gap needs a credible timeline before the next procurement review, which Lotte expects within two months at the outside.

## Sign-off

Reviewed by Dana and Kofi together on 2026-04-30; Priyam and Lotte read the summary and had no objections to the findings or priority ordering. Next review scheduled for three months out, or sooner if scope changes materially before then.
