-- Accel Case Intelligence: private storage, verification workflow, coverage, API views.

-- ---------------------------------------------------------------------------
-- Private storage bucket. Objects are stored under <firm_id>/<case_id>/<sha256>.pdf
-- and are readable only by members of that firm. Uploads by users go through
-- the attested upload flow; the worker writes with the service role.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('source-documents', 'source-documents', false, 104857600, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.storage_path_firm(object_name text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

create policy source_documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'source-documents'
    and app.is_firm_member(app.storage_path_firm(name))
  );

-- Users may upload only into their own firm's prefix, only if they hold a
-- writing role, and only when an attestation for that case already exists.
create policy source_documents_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'source-documents'
    and app.has_firm_role(app.storage_path_firm(name), array['admin', 'reviewer', 'analyst']::app.member_role[])
    and exists (
      select 1 from public.upload_attestations a
      where a.firm_id = app.storage_path_firm(name)
        and a.case_id::text = split_part(name, '/', 2)
        and a.uploader_id = auth.uid()
    )
  );

-- No user-level update or delete: documents are immutable evidence. Admins
-- remove documents through a service-role runbook with an audit event.

-- ---------------------------------------------------------------------------
-- Verification workflow. SECURITY INVOKER so RLS applies; role checks inside.
-- ---------------------------------------------------------------------------
create or replace function app.confirm_assertion(
  p_assertion_id uuid, p_note text default null, p_corroborated_by uuid default null)
returns public.assertions
language plpgsql
set search_path = ''
as $$
declare
  a public.assertions%rowtype;
begin
  select * into a from public.assertions where id = p_assertion_id for update;
  if not found then
    raise exception 'assertion % not found or not visible', p_assertion_id using errcode = 'no_data_found';
  end if;
  if not app.has_firm_role(a.firm_id, array['admin', 'reviewer']::app.member_role[]) then
    raise exception 'only reviewers and admins can confirm assertions' using errcode = 'insufficient_privilege';
  end if;
  if a.verification_status = 'superseded' then
    raise exception 'superseded assertions cannot be confirmed' using errcode = 'check_violation';
  end if;
  if a.origin = 'enriched' and coalesce(p_corroborated_by, a.corroborated_by_assertion_id) is null then
    raise exception 'an enriched assertion can only be confirmed with a corroborating court-record assertion'
      using errcode = 'check_violation';
  end if;
  update public.assertions
     set verification_status = 'confirmed',
         verified_by = auth.uid(),
         verified_at = now(),
         verification_note = p_note,
         corroborated_by_assertion_id = coalesce(p_corroborated_by, corroborated_by_assertion_id)
   where id = p_assertion_id
   returning * into a;
  update public.review_tasks
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         resolution = 'confirmed', resolution_note = p_note
   where assertion_id = p_assertion_id and status in ('open', 'in_progress');
  return a;
end;
$$;

create or replace function app.reject_assertion(p_assertion_id uuid, p_note text)
returns public.assertions
language plpgsql
set search_path = ''
as $$
declare
  a public.assertions%rowtype;
begin
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'a rejection requires a note' using errcode = 'check_violation';
  end if;
  select * into a from public.assertions where id = p_assertion_id for update;
  if not found then
    raise exception 'assertion % not found or not visible', p_assertion_id using errcode = 'no_data_found';
  end if;
  if not app.has_firm_role(a.firm_id, array['admin', 'reviewer']::app.member_role[]) then
    raise exception 'only reviewers and admins can reject assertions' using errcode = 'insufficient_privilege';
  end if;
  update public.assertions
     set verification_status = 'rejected', verified_by = auth.uid(), verified_at = now(), verification_note = p_note
   where id = p_assertion_id
   returning * into a;
  update public.review_tasks
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         resolution = 'rejected', resolution_note = p_note
   where assertion_id = p_assertion_id and status in ('open', 'in_progress');
  return a;
end;
$$;

-- A reviewer corrects a fact by entering a manual assertion that supersedes the old one.
create or replace function app.correct_assertion(
  p_assertion_id uuid, p_object_value jsonb, p_note text)
returns public.assertions
language plpgsql
set search_path = ''
as $$
declare
  old_a public.assertions%rowtype;
  new_a public.assertions%rowtype;
begin
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'a correction requires a note' using errcode = 'check_violation';
  end if;
  select * into old_a from public.assertions where id = p_assertion_id for update;
  if not found then
    raise exception 'assertion % not found or not visible', p_assertion_id using errcode = 'no_data_found';
  end if;
  if not app.has_firm_role(old_a.firm_id, array['admin', 'reviewer']::app.member_role[]) then
    raise exception 'only reviewers and admins can correct assertions' using errcode = 'insufficient_privilege';
  end if;
  insert into public.assertions (
    firm_id, case_id, subject_type, subject_id, predicate, object_value, object_type, object_id,
    source_document_id, page_number, quote, char_start, char_end,
    confidence, origin, verification_status, verified_by, verified_at, verification_note, created_by)
  values (
    old_a.firm_id, old_a.case_id, old_a.subject_type, old_a.subject_id, old_a.predicate, p_object_value,
    old_a.object_type, old_a.object_id,
    old_a.source_document_id, old_a.page_number, old_a.quote, old_a.char_start, old_a.char_end,
    1.0, 'manual', 'confirmed', auth.uid(), now(), p_note, auth.uid())
  returning * into new_a;
  update public.assertions
     set verification_status = 'superseded', superseded_by_assertion_id = new_a.id,
         verified_by = auth.uid(), verified_at = now(), verification_note = p_note
   where id = p_assertion_id;
  update public.review_tasks
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         resolution = 'corrected', resolution_note = p_note
   where assertion_id = p_assertion_id and status in ('open', 'in_progress');
  return new_a;
end;
$$;

create or replace function app.resolve_review_task(p_task_id uuid, p_resolution text, p_note text default null)
returns public.review_tasks
language plpgsql
set search_path = ''
as $$
declare
  t public.review_tasks%rowtype;
begin
  select * into t from public.review_tasks where id = p_task_id for update;
  if not found then
    raise exception 'review task % not found or not visible', p_task_id using errcode = 'no_data_found';
  end if;
  if not app.has_firm_role(t.firm_id, array['admin', 'reviewer']::app.member_role[]) then
    raise exception 'only reviewers and admins can resolve review tasks' using errcode = 'insufficient_privilege';
  end if;
  update public.review_tasks
     set status = case when p_resolution = 'dismissed' then 'dismissed'::app.review_task_status else 'resolved'::app.review_task_status end,
         resolved_by = auth.uid(), resolved_at = now(), resolution = p_resolution, resolution_note = p_note
   where id = p_task_id
   returning * into t;
  return t;
end;
$$;

grant execute on function app.confirm_assertion(uuid, text, uuid) to authenticated, service_role;
grant execute on function app.reject_assertion(uuid, text) to authenticated, service_role;
grant execute on function app.correct_assertion(uuid, jsonb, text) to authenticated, service_role;
grant execute on function app.resolve_review_task(uuid, text, text) to authenticated, service_role;

-- Automatically open a review task for low-confidence extracted assertions.
create or replace function app.open_review_for_low_confidence()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  threshold numeric;
begin
  select coalesce((f.settings ->> 'review_confidence_threshold')::numeric, 0.75)
    into threshold from public.firms f where f.id = new.firm_id;
  if new.origin in ('extracted', 'inferred') and new.verification_status = 'unverified'
     and new.confidence < threshold then
    insert into public.review_tasks (firm_id, case_id, task_type, priority, title, details, assertion_id)
    values (new.firm_id, new.case_id, 'low_confidence_assertion',
            case when new.confidence < 0.5 then 2 else 3 end,
            format('Low confidence (%s): %s', to_char(new.confidence, 'FM0.00'), new.predicate),
            jsonb_build_object('confidence', new.confidence, 'origin', new.origin),
            new.id);
  end if;
  return new;
end;
$$;
create trigger assertions_low_confidence_review after insert on public.assertions
  for each row execute function app.open_review_for_low_confidence();

-- Documents halted for restriction markers open a review task.
create or replace function app.open_review_for_restricted_document()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.processing_status = 'halted_restricted'
     and (tg_op = 'INSERT' or old.processing_status is distinct from 'halted_restricted') then
    insert into public.review_tasks (firm_id, case_id, task_type, priority, title, details, document_id)
    values (new.firm_id, new.case_id, 'restricted_document', 1,
            format('Restriction marker in %s', new.title),
            jsonb_build_object('restriction_flags', new.restriction_flags, 'docket_number', new.docket_number),
            new.id);
  end if;
  return new;
end;
$$;
create trigger source_documents_restricted_review after insert or update of processing_status on public.source_documents
  for each row execute function app.open_review_for_restricted_document();

-- ---------------------------------------------------------------------------
-- Coverage: computed, never hand-written. is_complete is always false.
-- ---------------------------------------------------------------------------
create or replace function app.case_coverage(p_case_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with c as (select * from public.cases where id = p_case_id),
       d as (
         select count(*) as acquired,
                count(*) filter (where processing_status in ('structured', 'published')) as processed,
                max(processed_at) as last_processed_at
         from public.source_documents where case_id = p_case_id
       )
  select jsonb_build_object(
    'documents_known_at_source', coalesce((c.coverage ->> 'documents_known_at_source')::int, 0),
    'documents_acquired', d.acquired,
    'documents_processed', d.processed,
    'last_processed_at', d.last_processed_at,
    'is_complete', false
  )
  from c, d;
$$;

create or replace function app.coverage_statement(p_case_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select format(
    'Derived from %s of %s publicly posted filings in %s%s. Not a claims register. Not complete.',
    coalesce((cov ->> 'documents_processed')::int, 0),
    coalesce((cov ->> 'documents_known_at_source')::int, 0),
    c.caption,
    case when c.docket_number is not null then format(' (%s %s)', coalesce(c.court, ''), c.docket_number) else '' end)
  from public.cases c, lateral app.case_coverage(c.id) cov
  where c.id = p_case_id;
$$;

create or replace function app.recompute_case_coverage(p_case_id uuid, p_documents_known integer default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cov jsonb;
begin
  if p_documents_known is not null then
    update public.cases
       set coverage = coverage || jsonb_build_object('documents_known_at_source', p_documents_known)
     where id = p_case_id;
  end if;
  cov := app.case_coverage(p_case_id);
  update public.cases set coverage = cov where id = p_case_id;
  return cov;
end;
$$;
grant execute on function app.case_coverage(uuid) to authenticated, service_role;
grant execute on function app.coverage_statement(uuid) to authenticated, service_role;
grant execute on function app.recompute_case_coverage(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- API views for the dashboard (security_invoker so RLS applies). Every fact row
-- carries origin, verification_status, confidence, and a citation.
-- ---------------------------------------------------------------------------
create view public.v_assertion_citations
with (security_invoker = true) as
select a.id as assertion_id,
       a.firm_id, a.case_id, a.subject_type, a.subject_id, a.predicate, a.object_value,
       a.object_type, a.object_id,
       a.origin, a.verification_status, a.confidence,
       jsonb_build_object(
         'document_id', a.source_document_id,
         'docket_number', d.docket_number,
         'title', d.title,
         'filed_date', d.filed_date,
         'page', a.page_number,
         'quote', a.quote,
         'original_url', d.original_url,
         'storage_bucket', d.storage_bucket,
         'storage_path', d.storage_path
       ) as citation,
       a.verified_by, a.verified_at, a.verification_note, a.created_at
from public.assertions a
left join public.source_documents d on d.id = a.source_document_id;

create view public.v_creditor_directory
with (security_invoker = true) as
select cr.id as creditor_id, cr.firm_id, cr.case_id,
       c.caption as case_caption, c.docket_number as case_docket_number, c.court,
       p.id as party_id, p.canonical_name, p.kind, p.aliases,
       cr.creditor_type, cr.claim_amount_asserted, cr.claim_group, cr.claim_set,
       cr.secured_property_ids, cr.treatment_summary,
       cr.is_individual, cr.enrichment_allowed,
       (select count(*) from public.assertions a
         where a.subject_type = 'creditor' and a.subject_id = cr.id and a.verification_status = 'confirmed') as confirmed_assertions,
       (select count(*) from public.assertions a
         where a.subject_type = 'creditor' and a.subject_id = cr.id and a.verification_status = 'unverified') as unverified_assertions,
       (select count(*) from public.assertions a
         where a.subject_type = 'creditor' and a.subject_id = cr.id and a.origin = 'enriched') as enriched_assertions,
       app.coverage_statement(cr.case_id) as coverage_statement,
       false as is_complete
from public.creditors cr
join public.parties p on p.id = cr.party_id
join public.cases c on c.id = cr.case_id;

create view public.v_case_profiles
with (security_invoker = true) as
select c.id as case_id, c.firm_id, c.caption, c.short_name, c.court, c.docket_number, c.judge,
       c.receiver_name, c.receiver_firm, c.appointment_date, c.case_type, c.status, c.summary,
       app.case_coverage(c.id) as coverage,
       app.coverage_statement(c.id) as coverage_statement,
       (select count(*) from public.parties p where p.case_id = c.id) as party_count,
       (select count(*) from public.creditors cr where cr.case_id = c.id) as creditor_count,
       (select count(*) from public.properties pr where pr.case_id = c.id) as property_count,
       (select count(*) from public.related_lawsuits rl where rl.case_id = c.id) as related_lawsuit_count,
       (select count(*) from public.assertions a where a.case_id = c.id and a.verification_status = 'confirmed') as confirmed_assertions,
       (select count(*) from public.assertions a where a.case_id = c.id and a.verification_status = 'unverified') as unverified_assertions,
       (select count(*) from public.assertions a where a.case_id = c.id and a.origin = 'inferred') as inferred_assertions,
       (select count(*) from public.assertions a where a.case_id = c.id and a.origin = 'enriched') as enriched_assertions,
       (select count(*) from public.review_tasks rt where rt.case_id = c.id and rt.status = 'open') as open_review_tasks
from public.cases c;

grant select on public.v_assertion_citations, public.v_creditor_directory, public.v_case_profiles to authenticated, service_role;
