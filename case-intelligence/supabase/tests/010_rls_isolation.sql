set search_path = tests, public, extensions;

-- A member of firm B must see nothing of firm A, through every tenant table and view.
create or replace function tests.test_rls_cross_tenant_isolation()
returns setof text
language plpgsql
as $$
declare
  fa record; fb record; da uuid; pa uuid; ca uuid; aa uuid;
  t text;
  n bigint;
begin
  select * into fa from tests.make_firm('alpha');
  select * into fb from tests.make_firm('bravo');
  da := tests.make_document(fa.firm_id, fa.case_id, fa.source_id, 'alpha-order');
  pa := tests.make_party(fa.firm_id, fa.case_id, 'BMO Harris Bank N.A.');
  insert into public.creditors (firm_id, case_id, party_id, creditor_type) values (fa.firm_id, fa.case_id, pa, 'institutional_lender') returning id into ca;
  insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value,
                                 source_document_id, page_number, quote, confidence, origin)
  values (fa.firm_id, fa.case_id, 'creditor', ca, 'has_role', '"lender"', da, 1, 'BMO Harris Bank N.A. holds a mortgage.', 0.9, 'extracted')
  returning id into aa;
  insert into public.review_tasks (firm_id, case_id, task_type, title) values (fa.firm_id, fa.case_id, 'manual', 'check');
  insert into public.related_lawsuits (firm_id, case_id, caption) values (fa.firm_id, fa.case_id, 'Appeal');
  insert into public.properties (firm_id, case_id, address) values (fa.firm_id, fa.case_id, '1 Main St');
  insert into public.attorneys (firm_id, case_id, full_name) values (fa.firm_id, fa.case_id, 'A. Lawyer');

  -- Firm B admin sees nothing of firm A.
  perform tests.as_user(fb.admin_id);
  foreach t in array array['firms', 'firm_members', 'sources', 'cases', 'source_documents', 'document_pages',
                           'parties', 'creditors', 'assertions', 'review_tasks', 'related_lawsuits',
                           'properties', 'attorneys', 'audit_log', 'enrichment_providers', 'pipeline_jobs',
                           'v_creditor_directory', 'v_case_profiles', 'v_assertion_citations'] loop
    execute format('select count(*) from public.%I where %I = $1', t, case when t = 'firms' then 'id' else 'firm_id' end) into n using fa.firm_id;
    return next is(n, 0::bigint, format('firm B admin sees no %s rows of firm A', t));
  end loop;

  -- Firm A readonly member sees firm A rows.
  perform tests.as_postgres();
  perform tests.as_user(fa.readonly_id);
  select count(*) into n from public.cases where firm_id = fa.firm_id;
  return next is(n, 1::bigint, 'firm A readonly sees its case');
  select count(*) into n from public.v_creditor_directory where firm_id = fa.firm_id;
  return next is(n, 1::bigint, 'firm A readonly sees its creditor directory row');
  select count(*) into n from public.audit_log where firm_id = fa.firm_id;
  return next is(n, 0::bigint, 'audit log is hidden from non-admin members');

  perform tests.as_postgres();
  perform tests.as_user(fa.admin_id);
  select count(*) into n from public.audit_log where firm_id = fa.firm_id;
  return next cmp_ok(n, '>', 0::bigint, 'audit log is visible to firm admins');
  perform tests.as_postgres();
end;
$$;

-- Cross-tenant writes are refused even when the attacker knows the ids.
create or replace function tests.test_rls_cross_tenant_writes_refused()
returns setof text
language plpgsql
as $$
declare
  fa record; fb record; n bigint;
begin
  select * into fa from tests.make_firm('charlie');
  select * into fb from tests.make_firm('delta');
  perform tests.as_user(fb.admin_id);
  return next throws_ok(
    format('insert into public.cases (firm_id, caption) values (%L, %L)', fa.firm_id, 'Injected'),
    '42501', null, 'firm B admin cannot insert a case into firm A');
  execute format('update public.cases set caption = %L where id = %L', 'Tampered', fa.case_id);
  execute format('delete from public.cases where id = %L', fa.case_id);
  perform tests.as_postgres();
  select count(*) into n from public.cases where id = fa.case_id and caption = 'In re charlie';
  return next is(n, 1::bigint, 'firm A case is unchanged after firm B update and delete attempts');
end;
$$;

-- Role matrix within a firm.
create or replace function tests.test_role_matrix()
returns setof text
language plpgsql
as $$
declare
  f record; n bigint;
begin
  select * into f from tests.make_firm('echo');
  perform tests.as_user(f.readonly_id);
  return next throws_ok(
    format('insert into public.cases (firm_id, caption) values (%L, %L)', f.firm_id, 'By readonly'),
    '42501', null, 'readonly cannot create a case');
  perform tests.as_postgres();

  perform tests.as_user(f.analyst_id);
  execute format('insert into public.cases (firm_id, caption) values (%L, %L)', f.firm_id, 'By analyst');
  select count(*) into n from public.cases where firm_id = f.firm_id and caption = 'By analyst';
  return next is(n, 1::bigint, 'analyst can create a case');
  return next throws_ok(
    format('insert into public.firm_members (firm_id, user_id, role) values (%L, %L, %L)', f.firm_id, f.readonly_id, 'admin'),
    '42501', null, 'analyst cannot change memberships');
  -- RLS filters the row out of the UPDATE rather than raising, so check the row is unchanged.
  execute format('update public.sources set status = %L where id = %L', 'suspended', f.source_id);
  perform tests.as_postgres();
  select count(*) into n from public.sources where id = f.source_id and status = 'validated';
  return next is(n, 1::bigint, 'analyst cannot change a source');

  perform tests.as_user(f.admin_id);
  execute format('update public.sources set status = %L where id = %L', 'suspended', f.source_id);
  perform tests.as_postgres();
  select count(*) into n from public.sources where id = f.source_id and status = 'suspended';
  return next is(n, 1::bigint, 'admin can suspend a source');
end;
$$;
