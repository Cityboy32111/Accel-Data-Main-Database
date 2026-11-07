set search_path = tests, public, extensions;

create or replace function tests.test_source_validation_requires_evidence()
returns setof text
language plpgsql
as $$
declare
  f record;
begin
  select * into f from tests.make_firm('foxtrot');
  return next throws_ok(
    format($q$insert into public.sources (firm_id, name, kind, status) values (%L, 'No evidence', 'public_web', 'validated')$q$, f.firm_id),
    '23514', null, 'a source cannot be validated without checklist evidence');
  return next throws_ok(
    format($q$insert into public.sources (firm_id, name, kind, status, legal_basis, terms_reviewed_at, access_test_at, approved_by)
            values (%L, 'No robots', 'public_web', 'validated', 'public', now(), now(), %L)$q$, f.firm_id, f.admin_id),
    '23514', null, 'a web source cannot be validated without a robots check');
  return next lives_ok(
    format($q$insert into public.sources (firm_id, name, kind, status, legal_basis, terms_reviewed_at, robots_checked_at, access_test_at, approved_by)
            values (%L, 'Complete', 'public_web', 'validated', 'public', now(), now(), now(), %L)$q$, f.firm_id, f.admin_id),
    'a source with complete evidence validates');
end;
$$;

create or replace function tests.test_documents_require_validated_source_and_attestation()
returns setof text
language plpgsql
as $$
declare
  f record; proposed uuid; upload_src uuid; att uuid;
begin
  select * into f from tests.make_firm('golf');
  insert into public.sources (firm_id, name, kind, status) values (f.firm_id, 'Proposed', 'public_web', 'proposed') returning id into proposed;
  return next throws_ok(
    format($q$insert into public.source_documents (firm_id, case_id, source_id, sha256, title)
            values (%L, %L, %L, repeat('a', 64), 'doc')$q$, f.firm_id, f.case_id, proposed),
    '23514', null, 'documents cannot be attached to an unvalidated source');

  insert into public.sources (firm_id, name, kind, status, legal_basis, terms_reviewed_at, access_test_at, approved_by)
  values (f.firm_id, 'Uploads', 'authorized_upload', 'validated', 'firm attestation', now(), now(), f.admin_id)
  returning id into upload_src;
  return next throws_ok(
    format($q$insert into public.source_documents (firm_id, case_id, source_id, sha256, title)
            values (%L, %L, %L, repeat('b', 64), 'upload without attestation')$q$, f.firm_id, f.case_id, upload_src),
    '23514', null, 'an uploaded document requires an attestation');

  insert into public.upload_attestations (firm_id, case_id, uploader_id, attestation_version, attestation_text,
    authorized_to_possess, authorized_to_process, not_sealed, no_protective_order_bar, privileged)
  values (f.firm_id, f.case_id, f.analyst_id, 'v1', 'I attest...', true, true, true, true, true) returning id into att;
  return next lives_ok(
    format($q$insert into public.source_documents (firm_id, case_id, source_id, upload_attestation_id, sha256, title)
            values (%L, %L, %L, %L, repeat('c', 64), 'attested upload')$q$, f.firm_id, f.case_id, upload_src, att),
    'an attested upload is accepted');
  return next is(
    (select privileged from public.source_documents where sha256 = repeat('c', 64)), true,
    'privileged flag is inherited from the attestation');
  return next throws_ok(
    format($q$insert into public.upload_attestations (firm_id, case_id, uploader_id, attestation_version, attestation_text,
              authorized_to_possess, authorized_to_process, not_sealed, no_protective_order_bar)
            values (%L, %L, %L, 'v1', 'x', true, true, false, true)$q$, f.firm_id, f.case_id, f.analyst_id),
    '23514', null, 'an attestation that admits the document is sealed is refused');
end;
$$;

create or replace function tests.test_assertion_constraints()
returns setof text
language plpgsql
as $$
declare
  f record; d uuid; p uuid; a_unconfirmed uuid; a_confirmed uuid;
begin
  select * into f from tests.make_firm('hotel');
  d := tests.make_document(f.firm_id, f.case_id, f.source_id, 'hotel-order');
  p := tests.make_party(f.firm_id, f.case_id, 'Citibank, N.A.');

  return next throws_ok(
    format($q$insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value, confidence, origin)
            values (%L, %L, 'party', %L, 'has_role', '"lender"', 0.9, 'extracted')$q$, f.firm_id, f.case_id, p),
    '23514', null, 'an extracted assertion without a page citation and quote is refused');

  return next throws_ok(
    format($q$insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value,
              source_document_id, page_number, quote, confidence, origin)
            values (%L, %L, 'party', %L, 'has_role', '"lender"', %L, 99, 'quote', 0.9, 'extracted')$q$, f.firm_id, f.case_id, p, d),
    '23514', null, 'a citation to a page beyond the document page count is refused');

  insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value,
                                 source_document_id, page_number, quote, confidence, origin)
  values (f.firm_id, f.case_id, 'party', p, 'has_role', '"lender"', d, 1, 'BMO Harris Bank N.A. holds a mortgage.', 0.9, 'extracted')
  returning id into a_unconfirmed;

  return next throws_ok(
    format($q$insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value, confidence, origin, verification_status, verified_by, verified_at)
            values (%L, %L, 'party', %L, 'domain', '"citi.com"', 0.8, 'enriched', 'confirmed', %L, now())$q$, f.firm_id, f.case_id, p, f.reviewer_id),
    '23514', null, 'an enriched assertion cannot be confirmed without corroboration');

  return next throws_ok(
    format($q$insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value, confidence, origin, verification_status, verified_by, verified_at, corroborated_by_assertion_id)
            values (%L, %L, 'party', %L, 'domain', '"citi.com"', 0.8, 'enriched', 'confirmed', %L, now(), %L)$q$, f.firm_id, f.case_id, p, f.reviewer_id, a_unconfirmed),
    '23514', null, 'corroboration by an unconfirmed assertion is refused');

  update public.assertions set verification_status = 'confirmed', verified_by = f.reviewer_id, verified_at = now() where id = a_unconfirmed;
  a_confirmed := a_unconfirmed;
  return next lives_ok(
    format($q$insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value, confidence, origin, verification_status, verified_by, verified_at, corroborated_by_assertion_id)
            values (%L, %L, 'party', %L, 'domain', '"citi.com"', 0.8, 'enriched', 'confirmed', %L, now(), %L)$q$, f.firm_id, f.case_id, p, f.reviewer_id, a_confirmed),
    'an enriched assertion corroborated by a confirmed court-record assertion can be confirmed');

  return next throws_ok(
    format($q$insert into public.assertions (firm_id, case_id, subject_type, subject_id, predicate, object_value, confidence, origin, verification_status)
            values (%L, %L, 'party', %L, 'x', '1', 0.5, 'manual', 'confirmed')$q$, f.firm_id, f.case_id, p),
    '23514', null, 'a confirmed status without verifier metadata is refused');
end;
$$;

create or replace function tests.test_enrichment_refuses_individuals()
returns setof text
language plpgsql
as $$
declare
  f record; org uuid; person uuid; prov uuid; cr_person uuid;
begin
  select * into f from tests.make_firm('india');
  org := tests.make_party(f.firm_id, f.case_id, 'Sabal Capital Operations, LLC', 'organization');
  person := tests.make_party(f.firm_id, f.case_id, 'Jane Investor', 'person');
  insert into public.enrichment_providers (firm_id, provider_key, display_name, enabled, credential_secret_name)
  values (f.firm_id, 'leadocean', 'Lead Ocean', true, 'LEADOCEAN_API_KEY') returning id into prov;

  return next throws_ok(
    format($q$insert into public.enrichment_providers (firm_id, provider_key, display_name, enabled, allowed_entity_kinds)
            values (%L, 'apollo', 'Apollo', true, array['organization','person']::app.entity_kind[])$q$, f.firm_id),
    '23514', null, 'a provider cannot be configured to enrich persons');

  return next throws_ok(
    format($q$insert into public.enrichment_jobs (firm_id, case_id, provider_id, subject_type, subject_id, requested_by)
            values (%L, %L, %L, 'party', %L, %L)$q$, f.firm_id, f.case_id, prov, person, f.analyst_id),
    '23514', null, 'enrichment of an individual party is refused');

  insert into public.creditors (firm_id, case_id, party_id, creditor_type, enrichment_allowed)
  values (f.firm_id, f.case_id, person, 'investor_lender', true) returning id into cr_person;
  return next is((select is_individual from public.creditors where id = cr_person), true, 'creditor inherits is_individual from party');
  return next is((select enrichment_allowed from public.creditors where id = cr_person), false, 'enrichment_allowed is forced false for individuals');
  return next throws_ok(
    format($q$insert into public.enrichment_jobs (firm_id, case_id, provider_id, subject_type, subject_id, requested_by)
            values (%L, %L, %L, 'creditor', %L, %L)$q$, f.firm_id, f.case_id, prov, cr_person, f.analyst_id),
    '23514', null, 'enrichment of an individual creditor is refused');

  return next lives_ok(
    format($q$insert into public.enrichment_jobs (firm_id, case_id, provider_id, subject_type, subject_id, requested_by)
            values (%L, %L, %L, 'party', %L, %L)$q$, f.firm_id, f.case_id, prov, org, f.analyst_id),
    'enrichment of an organization is accepted');

  update public.enrichment_providers set enabled = false where id = prov;
  return next throws_ok(
    format($q$insert into public.enrichment_jobs (firm_id, case_id, provider_id, subject_type, subject_id, requested_by)
            values (%L, %L, %L, 'party', %L, %L)$q$, f.firm_id, f.case_id, prov, org, f.analyst_id),
    '23514', null, 'a disabled provider refuses jobs');
end;
$$;
