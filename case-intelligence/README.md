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
