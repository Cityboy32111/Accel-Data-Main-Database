# Base44 Handoff (private): Supabase project jsfdewizzkyvbqziniou

Status: 2026-11-08. For whoever builds the Base44 interface. This document
names no secrets. Everything the dashboard needs is reachable with the
project's **publishable (anon) key** plus a signed-in user's JWT; the
service-role key stays inside Supabase and must never be configured in
Base44.

## 1. Connection

| Item | Value or where to find it |
| --- | --- |
| Project URL | `https://jsfdewizzkyvbqziniou.supabase.co` |
| Publishable key | Supabase dashboard, Project Settings, API keys. Use the anon / publishable key only. |
| REST base | `https://jsfdewizzkyvbqziniou.supabase.co/rest/v1/` |
| Auth base | `https://jsfdewizzkyvbqziniou.supabase.co/auth/v1/` |
| Storage base | `https://jsfdewizzkyvbqziniou.supabase.co/storage/v1/` |

Every request from Base44 carries two headers: `apikey: <publishable key>`
and `Authorization: Bearer <the signed-in user's access token>`. Row Level
Security runs on the user's token, so a Base44 bug can expose at most what
that user is allowed to see.

Before the first sign-in works from the Base44 origin, set in Supabase
dashboard, Authentication, URL Configuration: Site URL = the Base44 app URL,
and add it (plus any preview URL) to the Redirect URLs list. This step needs
the dashboard owner; it has not been done yet because the Base44 URL is not
known in this session.

## 2. Sign-in

Auth is invite-only (public sign-up disabled, minimum password 12
characters). Flow:

1. An admin invites the user: Supabase dashboard, Authentication, Users,
   Invite user (email). The user sets a password from the email link.
2. An admin adds the firm membership (Section 3). Without it the user
   authenticates but sees no rows.
3. Base44 signs the user in with email and password through the Supabase JS
   client and keeps the session; refresh tokens are handled by the client.

```js
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
```

## 3. Firm access

Tenancy is `firms` and `firm_members (firm_id, user_id, role)`. Roles:
`admin` (manage members, sources, providers; read audit log), `reviewer`
(confirm, reject, correct facts; resolve review tasks), `analyst` (create
cases, upload with attestation), `readonly`. A user may belong to several
firms; every row the dashboard reads carries `firm_id`.

Adding a member today is an admin SQL step in the dashboard SQL editor (an
RPC can be added later):

```sql
insert into public.firm_members (firm_id, user_id, role)
values ('<firm id>', '<auth.users id>', 'reviewer');
```

Demo firm id: `0f000000-0000-4000-8000-000000000001`. Pilot case id:
`0c000000-0000-4000-8000-000000000001`.

The dashboard can show the current user's firms and role with:

```js
const { data: memberships } = await supabase.from("firm_members").select("firm_id, role, firms(name, slug)");
```

## 4. Read model

Prefer the views; they already carry origin, verification status, confidence
and citation, and they never claim completeness.

| Source | Use |
| --- | --- |
| `v_case_profiles` | Case search and profile header: caption, court, docket, judge, receiver, computed `coverage` and `coverage_statement`, counts of confirmed, unverified, inferred and enriched assertions, open review tasks |
| `v_creditor_directory` | Creditor directory: one row per creditor with case caption, party name, type, claim group, `is_individual`, `enrichment_allowed`, confirmed and unverified counts, `coverage_statement`, `is_complete` (always false) |
| `v_assertion_citations` | Every fact with `origin`, `verification_status`, `confidence` and a `citation` object (document id, docket number, title, filed date, page, quote, original URL, storage path) |
| `parties`, `attorneys`, `properties`, `related_lawsuits` | Entity detail; `parties.resolution_cluster_id` groups alias rows once resolution is applied |
| `entity_links` with `predicate = 'same_as'` | Alias links from duplicate rows to the canonical row |
| `source_documents`, `document_pages` | Document list and page text (page text is PII-masked) |
| `review_tasks` | Review queue: `low_confidence_assertion`, `restricted_document`, `entity_resolution`, `manual` |
| `audit_log` | Admins only |

Examples:

```js
// Case search
await supabase.from("v_case_profiles").select("*").textSearch("caption", query, { type: "websearch" });

// Creditor directory for one case, institutional lenders first
await supabase.from("v_creditor_directory").select("*").eq("case_id", caseId).order("creditor_type");

// Facts about one creditor, with citations
await supabase.from("v_assertion_citations").select("*").eq("subject_type", "creditor").eq("subject_id", creditorId).order("page_number");
```

Display rules the product depends on:

- Show `origin` and `verification_status` on every fact. Confirmed facts get
  a verified badge; `inferred`, `enriched` and `unverified` must be visibly
  labeled, never styled like confirmed ones.
- Show `coverage_statement` on every creditor list and case profile. Do not
  compute a "total creditors" figure that reads as complete.
- Filter `is_individual = true` out of any export and never offer enrichment
  for those rows.
- When the modality columns land (pending migration
  `supabase/pending/20261108000200_assertion_modality.sql`), show `modality`
  and `conditions` beside each fact so a lawyer sees filing, proceeding and
  legal status together; until then `object_value` text carries the modality
  wording for version-2 extractions.

## 5. Private PDF links

The bucket `source-documents` is private. Members of the owning firm can
read their firm's prefix through RLS, so a short-lived signed URL made with
the user's own token is the right way to open a page:

```js
const { data: doc } = await supabase.from("source_documents").select("storage_bucket, storage_path, title").eq("id", documentId).single();
const { data: signed } = await supabase.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 600); // 10 minutes
window.open(`${signed.signedUrl}#page=${pageNumber}`);
```

Never make the bucket public and never proxy PDFs through a Base44 function
holding a privileged key. For a sensitive export, record an audit event
first (Section 6).

## 6. Source review and audit operations

All are PostgREST RPCs under the user's token; role checks run inside.

| RPC | Who | Effect |
| --- | --- | --- |
| `confirm_assertion(p_assertion_id, p_note, p_corroborated_by)` | reviewer, admin | Marks a fact confirmed with verifier and time; resolves its review task. An `enriched` fact needs `p_corroborated_by` pointing at a confirmed court-record fact. |
| `reject_assertion(p_assertion_id, p_note)` | reviewer, admin | Note required. |
| `correct_assertion(p_assertion_id, p_object_value jsonb, p_note)` | reviewer, admin | Creates a confirmed manual fact and marks the old one superseded (nothing is deleted). |
| `resolve_review_task(p_task_id, p_resolution, p_note)` | reviewer, admin | `p_resolution` free text; `'dismissed'` dismisses. |
| `record_audit_event(p_firm_id, p_action, p_table_name, p_row_id, p_details jsonb)` | any member | For sensitive reads: creditor export, PDF download of a privileged document. |
| `case_coverage(p_case_id)`, `coverage_statement(p_case_id)` | any member | Computed coverage. |

```js
await supabase.rpc("confirm_assertion", { p_assertion_id: id, p_note: "Matches Dkt. 1938 p. 2 para. 5(b)." });
await supabase.rpc("record_audit_event", { p_firm_id: firmId, p_action: "export.creditor_directory", p_table_name: "v_creditor_directory", p_row_id: null, p_details: { case_id: caseId, rows: n } });
```

Audit trail for admins:

```js
await supabase.from("audit_log").select("*").eq("firm_id", firmId).order("occurred_at", { ascending: false }).limit(200);
```

Every insert, update and delete on tenant tables is already audited by
trigger; the RPC above is for reads that matter.

## 7. What the dashboard should not do

- Hold the service-role key, call the `pipeline-ingest` or
  `pipeline-extract-test` functions, or accept uploads without the
  attestation flow (`upload_attestations` row first, then a signed upload
  into `<firm_id>/<case_id>/` ).
- Trigger enrichment. The provider framework exists but is off; requests to
  `enrichment_jobs` are refused for individuals and for disabled providers
  at the database layer.
- Present any list as complete.

## 8. Open items for the dashboard owner

1. Set Site URL and Redirect URLs once the Base44 URL exists.
2. Invite the first reviewer and add the `firm_members` row.
3. Decide whether reviewers should also see `pipeline_jobs` (a status page)
   and whether the review queue should surface `entity_resolution` tasks in
   the first release.
