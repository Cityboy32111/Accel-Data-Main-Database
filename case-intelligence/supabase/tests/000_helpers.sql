-- pgTAP helpers. Loaded first by scripts/run-db-tests.mjs into schema `tests`.
set search_path = tests, public, extensions;

create or replace function tests.make_user(p_email text)
returns uuid
language plpgsql
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
          extensions.crypt('test-password-not-usable', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now(), '', '', '', '');
  return uid;
end;
$$;

-- Impersonate an authenticated user for the rest of the current transaction.
create or replace function tests.as_user(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.as_postgres()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end;
$$;

-- A firm with one member of each role and one validated public source and a case.
create or replace function tests.make_firm(p_slug text)
returns table (firm_id uuid, admin_id uuid, reviewer_id uuid, analyst_id uuid, readonly_id uuid,
               source_id uuid, case_id uuid)
language plpgsql
as $$
declare
  f uuid; a uuid; r uuid; n uuid; o uuid; s uuid; c uuid;
begin
  insert into public.firms (name, slug) values ('Firm ' || p_slug, p_slug) returning id into f;
  a := tests.make_user(p_slug || '-admin@test.invalid');
  r := tests.make_user(p_slug || '-reviewer@test.invalid');
  n := tests.make_user(p_slug || '-analyst@test.invalid');
  o := tests.make_user(p_slug || '-readonly@test.invalid');
  insert into public.firm_members (firm_id, user_id, role) values
    (f, a, 'admin'), (f, r, 'reviewer'), (f, n, 'analyst'), (f, o, 'readonly');
  insert into public.sources (firm_id, name, kind, base_url, status, legal_basis, terms_reviewed_at,
                              robots_checked_at, access_test_at, approved_by)
  values (f, 'Public source ' || p_slug, 'public_web', 'https://example.invalid/', 'validated',
          'public record', now(), now(), now(), a)
  returning id into s;
  insert into public.cases (firm_id, caption, court, docket_number)
  values (f, 'In re ' || p_slug, 'Test Court', 'TC-' || p_slug) returning id into c;
  return query select f, a, r, n, o, s, c;
end;
$$;

create or replace function tests.make_document(p_firm uuid, p_case uuid, p_source uuid, p_title text)
returns uuid
language plpgsql
as $$
declare
  d uuid;
begin
  insert into public.source_documents (firm_id, case_id, source_id, original_url, sha256, title,
                                       document_category, docket_number, filed_date, page_count, storage_path)
  values (p_firm, p_case, p_source, 'https://example.invalid/' || p_title || '.pdf',
          encode(extensions.digest(p_title, 'sha256'), 'hex'), p_title, 'order', '1', '2020-01-01', 10,
          p_firm || '/' || p_case || '/' || encode(extensions.digest(p_title, 'sha256'), 'hex') || '.pdf')
  returning id into d;
  insert into public.document_pages (firm_id, document_id, page_number, text, text_method)
  values (p_firm, d, 1, 'The Court appoints Kevin B. Duff as Receiver. BMO Harris Bank N.A. holds a mortgage.', 'text_layer');
  return d;
end;
$$;

create or replace function tests.make_party(p_firm uuid, p_case uuid, p_name text, p_kind app.entity_kind default 'organization')
returns uuid
language plpgsql
as $$
declare
  p uuid;
begin
  insert into public.parties (firm_id, case_id, kind, canonical_name, party_roles)
  values (p_firm, p_case, p_kind, p_name, array['lender']::app.party_role[]) returning id into p;
  return p;
end;
$$;
