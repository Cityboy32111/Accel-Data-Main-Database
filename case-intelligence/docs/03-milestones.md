# Milestones

Status: proposed, awaiting approval. Version 0.1, 2026-11-07.

Each milestone ends with a demonstrable artifact, tests that pass in the
repository, and a short written acceptance check. Estimates are working days
of focused effort and assume the decisions in Section 2 are made before the
milestone starts.

## 1. Milestone plan

### M0. Proposal and approvals (this document)

Deliverable: architecture, source-access validation plan, milestones, and the
pilot source validation findings committed to the repository.

Acceptance: you approve the plan or return it with changes.

### M1. Foundation: schema, tenancy, audit, tests (3 days) — DELIVERED 2026-11-07

See [04-milestone-1-report.md](04-milestone-1-report.md) for what shipped, how to run it, and the configuration still needed.

- Supabase migrations for every table in the architecture document.
- RLS policies on all tenant tables and Storage buckets.
- Audit triggers and the append-only audit table.
- Check constraints for the confirmed/inferred contract.
- pgTAP suite: cross-tenant isolation for each table, audit trigger coverage,
  enrichment-confirmation constraint, append-only audit enforcement.
- Seed script: one demo firm, two users (admin, reviewer), the pilot source
  row in `validated` status with its checklist evidence.

Acceptance: `supabase db reset` followed by `supabase test db` passes; a
cross-tenant read attempt in the test suite returns zero rows.

### M2. Acquisition and text extraction for the pilot case (3 days)

- Receiver-site adapter: parse the index, map the four sections to document
  categories, parse docket numbers and filing dates from link text.
- Download the pilot subset with rate limiting, hashing, deduplication,
  private Storage, and `source_documents` rows.
- Screening stage: restriction markers and PII masking.
- Page text extraction with OCR fallback; `document_pages` populated.
- Unit tests on the parser against a saved copy of the index page, and on
  the screener against synthetic pages containing each marker.

Acceptance: the pilot subset is in Storage with page text; the coverage block
on the case reads documents known 809, acquired about 40, processed about 40.

### M3. LLM extraction with grounded citations (4 days)

- Versioned extraction schema and prompt for parties, attorneys, creditors,
  properties, related lawsuits, dates, and amounts.
- Grounding check that rejects any assertion whose quote is not found on the
  cited page.
- Confidence calibration: a golden set of 10 hand-labeled pages from the
  pilot documents; precision, recall, and citation accuracy reported per
  entity type.
- Assertions, extractions, and review tasks written for the pilot subset.

Acceptance: citation accuracy on the golden set at or above 0.95 (the quote
exists on the cited page); entity precision at or above 0.85 per type; every
assertion row has origin, confidence, and verification status.

### M4. Entity resolution and relationship graph (3 days)

- Blocking rules for names, docket numbers, addresses, and property numbers.
- LLM adjudication of ambiguous pairs with stored rationale.
- Cluster build; canonical entity rows for parties, creditors, attorneys,
  properties, related lawsuits; `entity_links`.
- Tests on synthetic near-duplicates and on known pairs from the pilot
  (the same lender named differently across objections).

Acceptance: the pilot case shows one canonical entity per real-world lender
and property in the subset, with every merge decision visible and reversible.

### M5. Enrichment framework (2 days)

- Provider adapter interface, `manual` adapter, and one commercial adapter
  chosen in Section 2.
- Per-firm configuration, daily caps, organizations-only rule, provenance as
  `enriched` assertions, redaction of fields the provider forbids storing.
- Tests with a recorded fixture of the provider response.

Acceptance: an institutional lender in the pilot case is enriched with a
domain and headquarters, shown as enriched and unverified, and a request to
enrich an individual is rejected with an audit event.

### M6. Read API and Base44 dashboard wiring (4 days)

- Edge Functions for every endpoint in the architecture document.
- Serializer that refuses to emit a fact without origin, status, confidence,
  and citation; signed URLs for page-level document viewing.
- Base44 app pages: case search, case profile, creditor directory, creditor
  detail, review queue. Verified badge and inferred/enriched labels; coverage
  statement on every creditor view.
- Contract tests for the API; an end-to-end check that a reviewer can confirm
  an assertion and see the badge change.

Acceptance: a signed-in reviewer in the demo firm can search the pilot case,
open a creditor, see each supporting citation, open the cited page, confirm
or reject the fact, and see the audit entry. A second firm's user sees
nothing from the demo firm.

### M7. Hardening and handoff (2 days)

- Security review of RLS, secrets handling, and Storage policies.
- Runbooks: adding a source, re-validating a source, rotating keys, running
  the pipeline, interpreting the review queue.
- Load the remaining pilot documents in the background and report the final
  coverage and extraction metrics.
- Draft pull request with the full change set.

Acceptance: documentation complete; all tests green; metrics reported.

Total: about 21 working days after approval, with M2 through M5 able to
overlap partially once M1 lands.

## 2. Decisions required before M1 starts (resolved 2026-11-07: Supabase project `jsfdewizzkyvbqziniou`, EquityBuild pilot confirmed, Lead Ocean as primary enrichment provider, dedicated environment "Accel Case Intelligence")

1. **Supabase project.** Create a new project for this MVP, or use an
   existing one? I need the project reference and one of: a Supabase access
   token for the CLI, or your agreement to run the migration files yourself.
   Database tools in this session are limited to logs and secrets, so I
   cannot apply migrations through the connector.
2. **Pilot case.** Confirm SEC v. EquityBuild (N.D. Ill. 18-cv-5587) via the
   receiver's public document site, with the roughly 40-document subset
   first. The alternative is a smaller state court commercial receivership,
   which would require a new source validation.
3. **Dashboard target.** Confirm the Base44 app "ECJ Law x Accel" (currently
   holds only a User entity) as the dashboard, or name a different app.
4. **LLM access.** An Anthropic API key for the worker, supplied through the
   environment's secret store when M3 begins. Default models are
   `claude-sonnet-5-5` for page extraction and `claude-opus-5-5` for
   adjudication and low-confidence pages.
5. **Enrichment provider for M5.** Your account has Apollo, LeadMagic, and
   Clay connected. Pick one for the first adapter; the pipeline will need
   that provider's API key in the secret store, since it calls the provider
   directly rather than through this chat session.
6. **Individuals policy.** Confirm that individual investor-claimants are
   stored only when named in public filings, flagged, and excluded from
   enrichment and export by default.
7. **Network allowlist.** Approve adding `rdaplaw.net`,
   `www.courtlistener.com`, `storage.courtlistener.com`, and the Supabase
   project host to the "Accel Outbound" environment when M2 begins.

## 3. Risks and how the plan treats them

| Risk | Treatment |
| --- | --- |
| LLM invents a citation or a creditor | Grounding check rejects unanchored output; golden-set citation accuracy is a release gate; nothing is confirmed without a reviewer. |
| Users read the creditor directory as a claims register | Computed coverage statement on every view and in every API response; `is_complete` is always false. |
| Scraping a source in a way its operator objects to | Validation checklist with recorded terms, robots, and rate limit; re-validation every 90 days; receiver site chosen because it exists to distribute these documents. |
| Cross-tenant leak | RLS as the only boundary, tested in pgTAP per table; service key confined to the worker. |
| Enrichment data presented as court fact | Separate origin value, check constraint, distinct labels; providers restricted to organizations. |
| Scanned exhibits defeat text extraction | OCR fallback with confidence recorded; low-confidence pages routed to review. |
| Cost overrun on LLM calls | Page-level extraction with a cheaper default model; per-case token budget; extraction cache keyed on page hash and prompt version. |
| Pilot case is an SEC equity receivership, not a state court commercial receivership | The entity model is the same; the source class differs. A state court case is the natural second source once the validation checklist has been exercised once. |
