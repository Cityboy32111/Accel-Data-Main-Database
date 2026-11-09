# Accel Case Intelligence

An MVP for law firms handling commercial receiverships. It ingests publicly
available court filings and authorized uploaded PDFs, extracts structured
entities with an LLM, matches those entities across documents, enriches
business contacts through configurable providers, and serves searchable case
profiles and a creditor directory to a Base44 dashboard. Every fact carries a
page-level source citation, a confidence rating, and a verification status, so
confirmed information is never presented the same way as inferred information.

Milestones 1 and 2 are delivered and the first Milestone 3 extraction sample
has run; see the reports below for how to run each stage. Repository layout: `supabase/` (migrations, pgTAP tests, seed),
`scripts/` (Management API migration and test runners), `worker/` (pipeline),
`supabase/functions/pipeline-ingest/` (the only component holding the service-role key),
`fixtures/equitybuild/` (saved index page and the pilot subset plan).

| Document | Purpose |
| --- | --- |
| [docs/01-architecture.md](docs/01-architecture.md) | System design, data model, pipeline stages, API surface, security model |
| [docs/02-source-access-validation.md](docs/02-source-access-validation.md) | How each source is cleared before ingestion, pilot source findings, what the system refuses to do |
| [docs/03-milestones.md](docs/03-milestones.md) | Delivery plan with acceptance criteria, decisions required, and open risks |
| [docs/04-milestone-1-report.md](docs/04-milestone-1-report.md) | What Milestone 1 delivered, runbooks, and configuration that needs your involvement |
| [docs/05-ingestion-report.md](docs/05-ingestion-report.md) | Edge Function credential mechanism, pilot ingestion results, access re-verification |
| [docs/06-extraction-report.md](docs/06-extraction-report.md) | Five-document extraction results, independent verification, defects fixed, tuning queue |
| [docs/07-extraction-review.md](docs/07-extraction-review.md) | Read-only review: settlement verdict, 10-page entity scorecard, citation accuracy, gate decision, sign-off list |
| [docs/08-retest-report.md](docs/08-retest-report.md) | Version-2 extractor regression retest on the same 10 pages: changes, side-by-side scorecard, cost, decision, fresh pages for the next check |
| [docs/09-base44-handoff.md](docs/09-base44-handoff.md) | Private Base44 handoff: sign-in, firm access, read model, private PDF links, review and audit operations |
| [docs/10-validation-and-readiness-report.md](docs/10-validation-and-readiness-report.md) | Version 2.1 fixes, out-of-sample fresh-page gate, entity alias resolution, enrichment readiness and what authorizes a live pilot |
| [docs/11-proceedings-retest-report.md](docs/11-proceedings-retest-report.md) | Authority-versus-proceeding rule, retest on ten proceedings-bearing pages, the three post-processing fixes it surfaced, gate decision and open definitions |

## Non-negotiable constraints

These are carried from the brief into the design and are enforced in code and
in the data model, not only in documentation:

1. Creditor lists are never described as complete. Every creditor view carries
   coverage metadata stating which documents it was derived from.
2. No court access restrictions are bypassed. No CAPTCHA solving, no login
   circumvention, no use of fee-exempt PACER accounts, no sealed or
   restricted documents.
3. No confidential records are accessed without authorization. Uploaded PDFs
   require an authorization attestation from the uploader before processing.
4. Confirmed and inferred information are distinct at the row level, in the
   API, and in the dashboard.
