# Milestone 1 Report: Foundation

Status: delivered 2026-11-07 against Supabase project `jsfdewizzkyvbqziniou`
(accel-case-intelligence, us-west-1, Postgres 17).

## 1. What was built

| Area | Delivered |
| --- | --- |
| Schema | 5 migrations under `supabase/migrations/`, applied to the project and recorded in `supabase_migrations.schema_migrations`. 22 tables across tenancy, evidence, assertions, entities, enrichment, review, audit, and pipeline queue. |
| Tenant isolation | Row Level Security on every table in `public` (asserted by a test). Membership and role checks run through `SECURITY DEFINER` helpers in schema `app`. Storage objects are scoped by the `<firm_id>/<case_id>/<sha256>.pdf` path prefix. |
| Authentication | Supabase Auth configured invite-only (`disable_signup`), minimum 12-character passwords, no anonymous sign-ins, re-authentication required for password changes. Roles: `admin`, `reviewer`, `analyst`, `readonly` in `firm_members`. |
| Private storage | Bucket `source-documents`, private, PDF only, 100 MiB limit. Members read their firm's prefix; uploads require a writing role and a prior attestation for that case; no user-level update or delete. |
| Audit logging | Trigger-fed, append-only `audit_log` on all 20 tenant tables with before/after diffs of changed keys. Page text and raw model output never enter the log. API-level events through `app.record_audit_event`. Firm admins read their own firm's log. |
| Verification workflow | `app.confirm_assertion`, `app.reject_assertion` (note required), `app.correct_assertion` (manual superseding assertion), `app.resolve_review_task`. Reviewer or admin only. Low-confidence extractions and restriction halts open review tasks automatically. |
| Confirmed vs inferred | `assertions.origin` (`extracted`, `inferred`, `enriched`, `manual`) and `verification_status` on every fact; extracted facts must cite a page and quote; enriched facts can only be confirmed when corroborated by a confirmed court-record assertion; the API views always emit both fields plus a citation object. |
| Completeness | `cases.coverage` is computed by `app.recompute_case_coverage`; `app.coverage_statement` ends with "Not a claims register. Not complete."; `v_creditor_directory.is_complete` is a constant `false`. |
| Individuals | `parties.is_individual` follows `kind = person`; creditors inherit it; `enrichment_allowed` is forced false for individuals; enrichment providers cannot be configured for persons; enrichment jobs for individuals are refused at the database layer. |
| Source registry | A source moves to `validated` only with legal basis, terms review, access test, approver, and for web sources a robots check. Documents cannot attach to an unvalidated source. Uploads need an attestation that matches firm and case; privileged flags propagate. |
| Seed | Demo firm, pipeline system account, the EquityBuild pilot case, the validated receiver-site source with its checklist evidence, CourtListener registered as `proposed`, and enrichment providers `manual` (enabled) and `leadocean` (disabled until a key is configured). |
| Tests | 13 pgTAP tests (cross-tenant isolation across 19 tables and views, cross-tenant writes, role matrix, source validation, attestation flow, assertion constraints, enrichment refusal for individuals, audit append-only, verification workflow, coverage statement, restriction review, storage policies, RLS-everywhere). 20 Vitest unit tests for the receiver-site parser, pilot subset selection, screening and masking, robots handling, and the polite fetcher. |
| Pipeline prep | Receiver-site index adapter (822 PDFs parsed into four sections with docket numbers and dates), a reviewable pilot subset of 39 documents in `fixtures/equitybuild/pilot-subset.json`, a polite fetcher (robots, one connection, 3 s spacing, PDF-only acceptance), screening with PII masking, page text extraction, and the `download` and `acquire` commands. |

## 2. How to run

All commands run from `case-intelligence/`. In the Claude cloud environment the
Management API token is injected by the network proxy, so a placeholder value
is enough; on a laptop set `SUPABASE_ACCESS_TOKEN` in `.env`.

```bash
npm install
```

```bash
npm run db:status
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run db:test
```

```bash
npm test
```

```bash
npm run worker -- plan --offline
```

```bash
NODE_USE_ENV_PROXY=1 npm run worker -- download
```

```bash
NODE_USE_ENV_PROXY=1 npm run worker -- acquire
```

`download` needs only network access to the receiver's site. `acquire` and
`coverage` need the project's service-role key (see Section 4).

## 3. Runbooks

**Add a source.** Insert a `sources` row as `proposed`, complete the checklist
columns (legal basis, terms URL and review date, robots result, access test
result), then have a firm admin set `status = validated` and `approved_by`. The
trigger refuses validation with missing evidence. Re-validation is due at
`revalidate_after` (90 days).

**Invite a user.** Supabase dashboard, Authentication, Invite user. Then a firm
admin inserts the `firm_members` row with the role. Signup is disabled, so
nobody can self-register.

**Clear a halted document.** Open the `restricted_document` review task, read
the cited markers in `source_documents.screening_notes`, and either resolve the
task with a documented basis and set `processing_status = screened`, or leave
the document halted.

**Rotate keys.** Service-role and Management API tokens live only in the
environment's network secrets or a local `.env`. Rotate in the Supabase
dashboard, then update the stored secret. Nothing in the repository changes.

**Audit retention.** Audit rows cannot be deleted except by a job that sets
`app.audit_retention = 'on'` for its transaction. No such job exists yet.

## 4. Configuration that needs your involvement

1. **Service-role key for the worker.** Two secure-form submissions were made
   for host `jsfdewizzkyvbqziniou.supabase.co`, but the environment now holds
   only one entry for that host (header `apikey`), and requests through it
   are answered "Invalid API key". The worker therefore cannot yet write to
   Storage or the database from the cloud session. To fix it, open the
   environment "Accel Case Intelligence" in Claude settings, Network secrets,
   and make sure the entry for that host holds the project's `service_role`
   key for both headers `apikey` and `Authorization` (prefix Bearer). The
   `download` stage is unaffected and has been run.
2. **Lead Ocean API key.** The `leadocean` provider row exists and is
   disabled. When Milestone 5 begins, I will request the key through the
   secure form; it is referenced in the database only by the secret name
   `LEADOCEAN_API_KEY`.
3. **Anthropic API key** for Milestone 3 extraction, requested the same way.
4. **Dashboard sign-in URL.** Auth `site_url` is still the default
   `http://localhost:3000`. Once the Base44 app URL is known it should be set
   as `site_url` and added to the redirect allow list.

## 5. Known gaps carried into Milestone 2

- OCR fallback is detected (pages flagged `none`) but not yet performed.
- The CourtListener cross-check adapter is registered but not implemented.
- `pipeline_jobs` exists; the worker currently runs stages inline rather than
  through the queue.
- No Edge Functions yet; the dashboard API views exist and are RLS-protected.
