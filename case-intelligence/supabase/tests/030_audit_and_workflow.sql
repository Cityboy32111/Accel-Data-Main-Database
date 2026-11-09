set search_path = tests, public, extensions;

create or replace function tests.test_audit_log_records_and_is_append_only()
returns setof text
language plpgsql
as $$
declare
  f record; c uuid; n bigint; aid bigint;
begin
  select * into f from tests.make_firm('juliet');
  perform tests.as_user(f.analyst_id);
  execute format('insert into public.cases (firm_id, caption) values (%L, %L)', f.firm_id, 'Audited case');
  perform tests.as_postgres();
  select id into c from public.cases where firm_id = f.firm_id and caption = 'Audited case';

  select count(*) into n from public.audit_log where table_name = 'cases' and row_id = c::text and action = 'insert' and actor_id = f.analyst_id;
  return next is(n, 1::bigint, 'insert by an analyst is audited with the actor id');

  update public.cases set status = 'closed' where id = c;
  select count(*) into n from public.audit_log where table_name = 'cases' and row_id = c::text and action = 'update'
     and before_data ->> 'status' = 'active' and after_data ->> 'status' = 'closed';
  return next is(n, 1::bigint, 'update is audited with a before/after diff of changed keys');

  select id into aid from public.audit_log where table_name = 'cases' and row_id = c::text limit 1;
  return next throws_ok(format('update public.audit_log set action = %L where id = %s', 'tampered', aid), '42501', null, 'audit rows cannot be updated');
  return next throws_ok(format('delete from public.audit_log where id = %s', aid), '42501', null, 'audit rows cannot be deleted');

  -- Page text never reaches the audit trail.
  perform tests.make_document(f.firm_id, f.case_id, f.source_id, 'juliet-doc');
  select count(*) into n from public.audit_log where table_name = 'document_pages' and after_data ? 'text';
  return next is(n, 0::bigint, 'document page text is excluded from audit payloads');

  -- Explicit API-level events.
  perform tests.as_user(f.readonly_id);
  perform app.record_audit_event(f.firm_id, 'export.creditor_directory', 'v_creditor_directory', null, '{"rows": 12}'::jsonb);
  perform tests.as_postgres();
  select count(*) into n from public.audit_log where firm_id = f.firm_id and action = 'export.creditor_directory' and actor_id = f.readonly_id;
  return next is(n, 1::bigint, 'explicit audit events record the acting user');
end;
$$;

create or replace function tests.test_verification_workflow()
returns setof text
language plpgsql
as $$
declare
  f record; d uuid; p uuid; a uuid; low uuid; n bigint; corrected public.assertions;
begin
  select * into f from tests.make_firm('kilo');
  d := tests.make_document(f.firm_id, f.case_id, f.source_id, 'kilo-order');
  p := tests.make_party(f.firm_id, f.case_id, 'Kevin B. Duff', 'person');

  insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value,
                                 source_document_id, page_number, quote, confidence, origin)
  values (f.firm_id, f.case_id, 'party', p, 'has_role', '"receiver"', d, 1, 'The Court appoints Kevin B. Duff as Receiver.', 0.95, 'extracted')
  returning id into a;
  insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value,
                                 source_document_id, page_number, quote, confidence, origin)
  values (f.firm_id, f.case_id, 'party', p, 'appointment_date', '"2018-08-17"', d, 1, 'appoints', 0.4, 'extracted')
  returning id into low;

  select count(*) into n from public.review_tasks where assertion_id = low and task_type = 'low_confidence_assertion' and status = 'open';
  return next is(n, 1::bigint, 'a low-confidence extracted assertion opens a review task automatically');
  select count(*) into n from public.review_tasks where assertion_id = a;
  return next is(n, 0::bigint, 'a high-confidence assertion opens no review task');

  -- Analysts cannot verify.
  perform tests.as_user(f.analyst_id);
  return next throws_ok(format('select app.confirm_assertion(%L)', a), '42501', null, 'an analyst cannot confirm an assertion');
  perform tests.as_postgres();

  -- Reviewer confirms.
  perform tests.as_user(f.reviewer_id);
  perform app.confirm_assertion(a, 'Matches the appointment order, p. 1.');
  perform tests.as_postgres();
  return next is((select verification_status from public.assertions where id = a), 'confirmed'::app.verification_status, 'reviewer confirmation is recorded');
  return next is((select verified_by from public.assertions where id = a), f.reviewer_id, 'verifier identity is recorded');

  -- Rejection requires a note; resolves the task.
  perform tests.as_user(f.reviewer_id);
  return next throws_ok(format('select app.reject_assertion(%L, %L)', low, ''), '23514', null, 'a rejection without a note is refused');
  perform app.reject_assertion(low, 'Date not on the cited page.');
  perform tests.as_postgres();
  return next is((select status from public.review_tasks where assertion_id = low), 'resolved'::app.review_task_status, 'rejecting an assertion resolves its review task');

  -- Correction supersedes.
  perform tests.as_user(f.reviewer_id);
  select * into corrected from app.correct_assertion(a, '"receiver (court-appointed)"'::jsonb, 'Clarified role wording.');
  perform tests.as_postgres();
  return next is((select verification_status from public.assertions where id = a), 'superseded'::app.verification_status, 'the corrected assertion is marked superseded');
  return next is((select superseded_by_assertion_id from public.assertions where id = a), corrected.id, 'the superseding assertion is linked');
  return next is(corrected.origin, 'manual'::app.assertion_origin, 'the correction is a manual assertion');
  return next is(corrected.verification_status, 'confirmed'::app.verification_status, 'the correction is confirmed by its author');

  -- A reviewer in another firm cannot touch it (RLS hides the row).
  perform tests.as_user((select reviewer_id from tests.make_firm('lima')));
  return next throws_ok(format('select app.confirm_assertion(%L)', corrected.id), 'P0002', null, 'another firm cannot see or confirm the assertion');
  perform tests.as_postgres();
end;
$$;

create or replace function tests.test_coverage_statement_never_claims_completeness()
returns setof text
language plpgsql
as $$
declare
  f record; cov jsonb; stmt text;
begin
  select * into f from tests.make_firm('mike');
  insert into public.creditors (firm_id, case_id, party_id, creditor_type)
  values (f.firm_id, f.case_id, tests.make_party(f.firm_id, f.case_id, 'Mike Lender LLC'), 'secured_lender');
  perform tests.make_document(f.firm_id, f.case_id, f.source_id, 'mike-1');
  perform tests.make_document(f.firm_id, f.case_id, f.source_id, 'mike-2');
  update public.source_documents set processing_status = 'published' where title = 'mike-1';
  cov := app.recompute_case_coverage(f.case_id, 800);
  return next is((cov ->> 'documents_known_at_source')::int, 800, 'coverage records the documents known at source');
  return next is((cov ->> 'documents_acquired')::int, 2, 'coverage counts acquired documents');
  return next is((cov ->> 'documents_processed')::int, 1, 'coverage counts processed documents');
  return next is((cov ->> 'is_complete')::boolean, false, 'coverage never reports completeness');
  stmt := app.coverage_statement(f.case_id);
  return next matches(stmt, 'Derived from 1 of 800', 'statement cites processed over known');
  return next matches(stmt, 'Not complete\.$', 'statement ends with Not complete');
  return next is((select is_complete from public.v_creditor_directory where firm_id = f.firm_id limit 1), false, 'creditor directory view carries is_complete = false');
  return next matches((select coverage_statement from public.v_creditor_directory where firm_id = f.firm_id limit 1), 'Not complete\.$', 'creditor directory rows carry the coverage statement');
end;
$$;

create or replace function tests.test_restricted_document_opens_review()
returns setof text
language plpgsql
as $$
declare
  f record; d uuid; n bigint;
begin
  select * into f from tests.make_firm('november');
  d := tests.make_document(f.firm_id, f.case_id, f.source_id, 'november-sealed');
  update public.source_documents set processing_status = 'halted_restricted', restriction_flags = array['sealed_marker'] where id = d;
  select count(*) into n from public.review_tasks where document_id = d and task_type = 'restricted_document' and priority = 1;
  return next is(n, 1::bigint, 'a restriction halt opens a priority-1 review task');
end;
$$;

create or replace function tests.test_storage_bucket_is_private_and_scoped()
returns setof text
language plpgsql
as $$
begin
  return next is((select public from storage.buckets where id = 'source-documents'), false, 'source-documents bucket is private');
  return next is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname in ('source_documents_read', 'source_documents_upload')), 2::bigint,
                 'read and attested-upload policies exist on storage.objects');
  return next is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and cmd in ('UPDATE', 'DELETE')), 0::bigint, 'no user-level update or delete policy on documents');
  return next is(app.storage_path_firm('0f000000-0000-4000-8000-000000000001/0c000000-0000-4000-8000-000000000001/abc.pdf'),
                 '0f000000-0000-4000-8000-000000000001'::uuid, 'firm id is parsed from the object path');
  return next is(app.storage_path_firm('not-a-uuid/abc.pdf'), null, 'malformed paths yield no firm');
end;
$$;

create or replace function tests.test_rls_enabled_on_all_public_tables()
returns setof text
language plpgsql
as $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  return next is(missing, null, 'every table in public has row level security enabled');
end;
$$;
