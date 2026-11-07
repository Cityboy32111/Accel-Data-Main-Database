# Architecture Proposal

Status: proposed, awaiting approval. Version 0.1, 2026-11-07.

## 1. Goals and scope

The MVP answers three questions for a receivership practice group:

1. What do we know about this case, and where exactly in the record does each
   fact come from?
2. Who are the creditors, lenders, and other parties, which ones are
   confirmed by a court filing, and which ones are only inferred?
3. How do we reach the business contacts that matter, using enrichment
   sources the firm has chosen and can audit?

Out of scope for the MVP: PACER integration, state court e-filing portals,
consumer (individual) contact enrichment, document drafting, billing, and any
write-back into court systems.

## 2. System overview

```
                 ┌──────────────────────────────────────────────┐
                 │               Source registry                 │
                 │  public web sources · authorized uploads      │
                 └──────────────┬───────────────────────────────┘
                                │ validated sources only
                                ▼
┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐
│ Acquire  │──▶│ Extract  │──▶│  Structure   │──▶│   Resolve    │──▶│    Enrich     │
│ fetch /  │   │ page     │   │  LLM entity  │   │  match       │   │  configurable │
│ upload,  │   │ text,    │   │  extraction  │   │  entities    │   │  providers,   │
│ hash,    │   │ OCR      │   │  with page   │   │  across      │   │  business     │
│ dedupe   │   │ fallback │   │  citations   │   │  documents   │   │  contacts only│
└──────────┘   └──────────┘   └──────────────┘   └──────────────┘   └───────────────┘
      │              │               │                  │                   │
      └──────────────┴───────────────┴──────────────────┴───────────────────┘
                                     │  every write audited, firm-scoped
                                     ▼
                      ┌───────────────────────────────┐
                      │  Supabase (Postgres + RLS,     │
                      │  Auth, Storage, Edge Functions)│
                      └──────────────┬────────────────┘
                                     │ REST (JWT per user)
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
            Base44 dashboard                  Human review queue
     (case profiles, creditor directory)   (confirm / reject / correct)
```

### Components

| Component | Technology | Why |
| --- | --- | --- |
| Database, auth, file storage | Supabase (Postgres 15, Supabase Auth, Storage, Row Level Security) | Required by the brief. RLS gives tenant isolation at the database layer rather than in application code. |
| Read API for the dashboard | Supabase Edge Functions (Deno, TypeScript) in front of PostgREST | Base44 backend functions are Deno; a small typed API hides table shape and enforces the confirmed/inferred contract on every response. |
| Pipeline worker | Node 22, TypeScript, run as a CLI and on a schedule | PDF parsing and LLM calls are long-running and bursty; a worker that claims jobs from a Postgres queue table is simpler and cheaper than forcing them through Edge Functions. |
| PDF text extraction | `pdfjs-dist` for text-layer PDFs, Tesseract OCR as a fallback for scanned pages | Most federal filings have a text layer; older exhibits do not. |
| LLM extraction | Anthropic Claude via the Messages API with JSON-schema structured output. Default `claude-sonnet-5-5` for page extraction, `claude-opus-5-5` for low-confidence pages and entity adjudication. | Page-by-page extraction keeps citations exact and keeps cost bounded. |
| Entity resolution | Deterministic blocking (normalized names, docket numbers, addresses) followed by LLM adjudication of candidate pairs | Deterministic rules are auditable; the LLM only decides ambiguous pairs, and its decision is stored with a rationale. |
| Enrichment | Provider adapter interface with a `manual` adapter and one commercial adapter in the MVP | Providers differ per firm and per contract; the adapter boundary keeps provenance uniform. |
| Tests | Vitest for TypeScript, pgTAP for RLS policies and triggers, golden-set evaluation for extraction quality | RLS is the security boundary and must be tested as code. |

## 3. Data model

All tenant tables carry `firm_id` and are protected by RLS. The schema is
organized in four layers so that raw evidence, extracted assertions, and
curated entities never collapse into each other.

### 3.1 Tenancy and access

- `firms` – tenant. One row per law firm.
- `firm_members` – maps an auth user to a firm with a role: `admin`,
  `reviewer`, `analyst`, `readonly`.
- `audit_log` – append-only. Written by triggers on every tenant table and by
  the API for reads of sensitive views (creditor exports, enrichment results).
  Records actor, firm, action, table, row id, before/after diff, request id.

### 3.2 Evidence layer (what we actually have)

- `sources` – the source registry. Fields: `kind` (`public_web`,
  `court_mirror`, `authorized_upload`), `base_url`, `access_class`,
  `terms_reviewed_at`, `terms_evidence_url`, `robots_checked_at`,
  `rate_limit_per_minute`, `status` (`proposed`, `validated`, `suspended`).
  Ingestion refuses any source not in `validated`.
- `source_documents` – one row per acquired file. Fields: `source_id`,
  `case_id`, `original_url`, `storage_path` (private bucket, firm-scoped),
  `sha256`, `docket_number`, `filed_date`, `title`, `document_category`
  (`order`, `status_report`, `claims_process`, `pleading`, `exhibit`,
  `upload`), `page_count`, `restriction_flags` (array: `sealed_marker`,
  `protective_order_reference`, `redaction_present`, `pii_detected`),
  `upload_attestation_id` (required when `kind = authorized_upload`).
- `document_pages` – one row per page: `page_number`, `text`,
  `text_method` (`text_layer`, `ocr`), `char_count`, `ocr_confidence`.
- `upload_attestations` – who uploaded, when, and the attestation text the
  uploader accepted (authorized to possess and process; not sealed; not
  subject to a protective order barring this use; privileged flag).

### 3.3 Assertion layer (what documents say)

- `extractions` – one row per LLM call: model, prompt version, input page
  range, raw JSON output, token counts, latency. Kept for reproducibility.
- `assertions` – the central table. Each is one atomic fact about one entity
  attributed to one page. Fields:
  - `subject_entity_id`, `predicate` (for example `has_role`, `claim_amount`,
    `secured_by_property`, `represented_by`, `address`, `related_case`),
    `object_value` (jsonb), `object_entity_id` (nullable)
  - `source_document_id`, `page_number`, `quote` (verbatim span of at most
    500 characters), `char_start`, `char_end`
  - `confidence` numeric 0 to 1 as reported by the extractor and calibrated
    against the golden set
  - `origin`: `extracted` (stated in the document), `inferred` (derived by
    matching or by the LLM from indirect evidence), `enriched` (from a
    third-party provider), `manual` (entered by a reviewer)
  - `verification_status`: `unverified`, `confirmed`, `rejected`,
    `superseded`
  - `verified_by`, `verified_at`, `verification_note`
  - `extraction_id`

  A constraint enforces that `origin = enriched` can never have
  `verification_status = confirmed` unless a reviewer explicitly records the
  confirmation against a court-record assertion that corroborates it.

### 3.4 Entity layer (what we believe exists)

Entities are curated views over assertions. They are stored as rows so the
dashboard can query them directly, but every displayed attribute is resolved
from assertions and carries the best-supporting citation.

- `cases` – caption, court, docket number, judge, receiver, appointment date,
  status, `coverage` jsonb (documents known at source, documents acquired,
  documents processed, last processed at).
- `parties` – any person or organization in the case. Fields: `kind`
  (`person`, `organization`), `canonical_name`, `party_roles` (array:
  `defendant`, `plaintiff`, `receiver`, `relief_defendant`, `intervenor`,
  `objector`, `claimant`, `purchaser`), `entity_resolution_cluster_id`.
- `creditors` – a party with a creditor relationship to the estate. Fields:
  `party_id`, `creditor_type` (`institutional_lender`, `secured_lender`,
  `investor_lender`, `trade_creditor`, `taxing_authority`, `professional`,
  `other`), `claim_amount_asserted`, `claim_group`, `secured_property_ids`,
  `treatment_summary`. Individual investor-claimants are stored only when
  named in a public filing and are flagged `is_individual = true`, which
  disables enrichment and export by default (see Section 6).
- `attorneys` – name, bar jurisdiction, firm, `represents_party_ids`,
  appearance evidence.
- `properties` – address, parcel identifier where stated, receiver property
  number, disposition (`held`, `marketed`, `sold`, `foreclosed`), sale price,
  sale approval docket number.
- `related_lawsuits` – caption, court, docket number, relationship
  (`appeal`, `state_court_action`, `adversary`, `foreclosure`,
  `enforcement`), status.
- `entity_links` – edges between entities with predicate, supporting
  assertion ids, and `link_origin` (`extracted`, `inferred`, `manual`).
- `entity_resolution_decisions` – candidate pair, blocking rule that
  proposed it, decision (`merge`, `distinct`, `undecided`), decided by
  (`rule`, `llm`, `reviewer`), rationale.

### 3.5 Enrichment layer

- `enrichment_providers` – per firm: provider key (`manual`, `apollo`,
  `leadmagic`, `clay`), display name, enabled, credential reference (name of
  a Supabase secret, never the value), `allowed_entity_kinds` (organizations
  only by default), daily cap, cost per lookup, terms URL.
- `enrichment_jobs` and `enrichment_results` – request, provider, raw
  response (redacted of anything the provider's terms forbid storing),
  normalized fields (domain, headquarters, phone, role-level contacts),
  `retrieved_at`, `provider_confidence`. Results become `assertions` with
  `origin = enriched`.

### 3.6 Review layer

- `review_tasks` – generated when an assertion's confidence is below the
  firm's threshold, when entity resolution is `undecided`, when a document
  carries a restriction flag, or when an enrichment result conflicts with a
  court-record assertion. Fields: type, priority, assigned to, status,
  resolution, linked assertion or decision ids.

## 4. Pipeline stages

Each stage is a job type in `pipeline_jobs` (status, attempts, lease, error).
Stages are idempotent and keyed on content hashes so re-runs do not duplicate.

1. **Acquire.** For a `public_web` source, fetch the index page, parse the
   document list, and download only documents not already present by
   `sha256`. Honor `robots.txt`, a per-source rate limit, a descriptive
   `User-Agent` identifying the firm, and `If-Modified-Since`. For an
   `authorized_upload`, accept the file only after an attestation row exists.
   Store in a private Storage bucket under `firm_id/case_id/sha256.pdf`.
2. **Screen.** Before any extraction, scan the first three pages and the
   docket caption for restriction markers (`SEALED`, `FILED UNDER SEAL`,
   `CONFIDENTIAL`, `PROTECTIVE ORDER`, `REDACTED`) and for personal data
   patterns (SSN, account numbers, dates of birth). Sealed markers halt
   processing and open a review task. PII patterns are masked in
   `document_pages.text` and the original stays only in Storage.
3. **Extract text.** Per page. Text layer first; OCR when a page yields fewer
   than 40 characters. Record the method.
4. **Structure.** Per page or small page window, call the LLM with a schema
   that requires, for every entity and relationship, a verbatim quote and the
   page number. Reject any output whose quote cannot be located in the page
   text (fuzzy match above 0.9). This grounding check is the primary defense
   against fabricated citations.
5. **Resolve.** Block candidate pairs deterministically, adjudicate ambiguous
   pairs with the LLM, store every decision with its rationale, and build
   clusters. A merge of two clusters never deletes assertions; it re-points
   the canonical entity.
6. **Enrich.** Only for organizations and professional roles, only through
   providers enabled for the firm, only within the daily cap. Results are
   stored as `enriched` assertions and never alter `extracted` ones.
7. **Publish.** Recompute entity rows, coverage metadata, and the search
   index (Postgres full-text plus trigram on names). Emit review tasks.

## 5. API surface for the Base44 dashboard

All endpoints require a Supabase JWT. The firm is derived from `firm_members`,
never from a request parameter. Every response that includes a fact includes
its `origin`, `verification_status`, `confidence`, and a `citation` object
(`document_id`, `docket_number`, `page`, `quote`, `signed_url` valid for 10
minutes).

| Method and path | Purpose |
| --- | --- |
| `GET /cases?q=` | Search case profiles by caption, docket, court, party name |
| `GET /cases/:id` | Case profile: parties, attorneys, properties, related lawsuits, coverage block, counts of confirmed vs inferred assertions |
| `GET /cases/:id/documents` | Documents with categories, restriction flags, processing status |
| `GET /cases/:id/timeline` | Dated events drawn from confirmed and extracted assertions |
| `GET /creditors?q=&type=&status=` | Creditor directory across cases with filters for creditor type and verification status. Always returns a `coverage_statement` string and `is_complete: false` |
| `GET /creditors/:id` | Creditor detail with every supporting citation and enrichment results labeled as such |
| `GET /review/tasks`, `POST /review/tasks/:id/resolve` | Human review queue and resolution (confirm, reject, correct with note) |
| `POST /documents/upload-intent` | Returns a signed upload URL only after the attestation payload is accepted and stored |
| `POST /enrichment/requests` | Request enrichment for an organization; rejected for individuals |
| `GET /audit?entity_id=` | Audit trail for an entity (admins only) |

The dashboard lives in the existing Base44 app named "ECJ Law x Accel"
(pending confirmation). Base44 backend functions call these endpoints with the
signed-in user's JWT; the Base44 app never holds the Supabase service key.

## 6. Security, privacy, and integrity model

- **Tenant isolation.** RLS on every tenant table using the caller's firm
  memberships. pgTAP tests assert that a user in firm A cannot read, insert,
  update, or delete any row in firm B through any table or view. Storage
  policies mirror the same rule by path prefix.
- **Service role containment.** Only the pipeline worker holds the service
  key, as an environment secret, and it sets `firm_id` explicitly from the
  job row. Edge Functions use the caller's JWT.
- **Audit logging.** Trigger-based for writes; API-level for sensitive reads.
  Audit rows cannot be updated or deleted by any role except a scheduled
  retention job.
- **Confirmed versus inferred.** Enforced by the `origin` and
  `verification_status` columns, by a check constraint on enrichment
  confirmation, by API serializers that refuse to emit a fact without those
  fields, and by dashboard styling rules (confirmed facts in normal weight
  with a verified badge, inferred and enriched facts visibly labeled).
- **Completeness.** `cases.coverage` and the creditor directory's
  `coverage_statement` are computed, not hand-written. Example statement:
  "Derived from 38 of 823 publicly posted filings in SEC v. EquityBuild
  (N.D. Ill. 18-cv-5587). Not a claims register. Not complete."
- **Individuals.** Individual investor-claimants in a receivership are often
  retail victims. They are stored only when named in a public filing, flagged
  `is_individual`, excluded from enrichment, excluded from exports by default,
  and never treated as leads. This is a product decision as much as a legal
  one and is listed for confirmation in the milestones document.
- **LLM boundaries.** Prompts contain only text from validated sources and
  firm-authorized uploads. Document text is treated as untrusted content;
  the extractor schema forbids free-form instructions and the grounding check
  discards any output not anchored in the page.
- **Secrets.** Provider and LLM keys live in Supabase secrets or the worker's
  environment. No key is stored in the database or in the repository.

## 7. Repository layout (proposed)

```
case-intelligence/
  docs/                      proposal, ADRs, runbooks
  supabase/
    migrations/              numbered SQL migrations
    tests/                   pgTAP: RLS, triggers, constraints
    functions/               Edge Functions: cases, creditors, review, upload, enrichment, audit
  worker/
    src/acquire/             source adapters (receiver-site, courtlistener, upload)
    src/screen/              restriction and PII screening
    src/extract/             pdf text, ocr
    src/structure/           LLM schemas, prompts (versioned), grounding check
    src/resolve/             blocking rules, adjudication
    src/enrich/              provider adapters
    src/publish/             entity recompute, coverage, search index
    test/                    unit tests, golden set evaluation
  fixtures/golden/           hand-labeled pages for extraction evaluation
```
