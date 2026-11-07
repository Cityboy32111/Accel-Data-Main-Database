-- Seed: demo firm, system user, and the validated pilot source for the
-- EquityBuild receivership. Idempotent.
--
-- The system user exists so that validation approvals and worker-created rows
-- have an actor. It has an unusable random password; people are invited through
-- Supabase Auth and added to firm_members by an admin.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values (
  '00000000-0000-0000-0000-000000000000',
  '0a000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated',
  'system@accel-case-intelligence.invalid',
  extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
  now(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"display_name":"Pipeline system account"}'::jsonb,
  false, now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into public.firms (id, name, slug, settings)
values ('0f000000-0000-4000-8000-000000000001', 'Demo Firm (Accel Case Intelligence)', 'demo-firm',
        '{"review_confidence_threshold": 0.75}'::jsonb)
on conflict (id) do nothing;

insert into public.firm_members (firm_id, user_id, role, display_name)
values ('0f000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'admin', 'Pipeline system account')
on conflict (firm_id, user_id) do nothing;

-- Pilot case.
insert into public.cases (id, firm_id, caption, short_name, court, docket_number, judge,
                          receiver_name, receiver_firm, appointment_date, case_type, status, summary)
values (
  '0c000000-0000-4000-8000-000000000001',
  '0f000000-0000-4000-8000-000000000001',
  'SEC v. EquityBuild, Inc., et al.',
  'EquityBuild Receivership',
  'N.D. Ill.',
  '1:18-cv-05587',
  'Manish S. Shah',
  'Kevin B. Duff',
  'Rachlis Duff & Peel, LLC',
  '2018-08-17',
  'receivership',
  'active',
  'SEC equity receivership over EquityBuild, Inc., EquityBuild Finance, LLC and affiliates; Chicago real estate portfolio; claims process with institutional and investor lenders. Appointment date is taken from the receiver''s public case page and is subject to confirmation against the appointment order.')
on conflict (firm_id, docket_number, court) do nothing;

-- Pilot source: receiver-published public record. Checklist evidence recorded on
-- 2026-11-07; see docs/02-source-access-validation.md section 3.1.
insert into public.sources (
  id, firm_id, name, kind, base_url, access_class, status, legal_basis, terms_url, terms_reviewed_at, terms_notes,
  robots_checked_at, robots_result, access_test_at, access_test_result,
  rate_limit_per_minute, min_delay_ms, store_copy, sensitivity_notes, approved_by, approved_at, revalidate_after)
values (
  '05000000-0000-4000-8000-000000000001',
  '0f000000-0000-4000-8000-000000000001',
  'EquityBuild Receivership document site (rdaplaw.net)',
  'public_web',
  'https://rdaplaw.net/equitybuild-receivership/',
  'public_no_login',
  'validated',
  'Court filings published by the court-appointed receiver for claimants and the public. Page states: "You may access documents filed in the lawsuit by clicking on the links below." No login, no fee.',
  'https://rdaplaw.net/',
  '2026-11-07T20:52:00Z',
  'No site terms restricting access to the receivership documents were found on the page. Documents are public court filings.',
  '2026-11-07T20:52:00Z',
  'User-agent: * / Disallow: /wp-admin/ / Allow: /wp-admin/admin-ajax.php. Document PDFs under /wp-content/uploads/ are allowed.',
  '2026-11-07T20:52:00Z',
  '{"index_http_status": 200, "pdf_links": 822, "sections": {"orders": 472, "claims_process": 249, "other_pleadings": 52, "status_reports": 50}, "interstitial": false, "captcha": false, "login": false}'::jsonb,
  20, 3000, true,
  'Claims process documents name individual investor-claimants. Individuals are stored only when named in a public filing, flagged is_individual, and excluded from enrichment and export by default.',
  '0a000000-0000-4000-8000-000000000001',
  '2026-11-07T20:52:00Z',
  '2027-02-05T00:00:00Z')
on conflict (firm_id, name) do nothing;

-- Secondary source, registered but not yet validated for ingestion: metadata cross-check only.
insert into public.sources (
  id, firm_id, name, kind, base_url, access_class, status, legal_basis, terms_url, terms_reviewed_at, terms_notes,
  robots_checked_at, robots_result, rate_limit_per_minute, min_delay_ms, store_copy, sensitivity_notes)
values (
  '05000000-0000-4000-8000-000000000002',
  '0f000000-0000-4000-8000-000000000001',
  'CourtListener RECAP (metadata cross-check)',
  'court_mirror',
  'https://www.courtlistener.com/',
  'api_token_required',
  'proposed',
  'Public court filings mirrored by Free Law Project. Use limited to docket metadata cross-check for the pilot case, within published rate limits, under a single firm-registered token.',
  'https://www.courtlistener.com/terms/',
  '2026-11-07T20:52:00Z',
  'Terms (last modified 2026-08-05): token required; rate limits may not be circumvented with multiple accounts; no credential pooling; team/product use requires a commercial agreement; no FCRA use; do not imply Free Law Project endorsed AI analysis.',
  '2026-11-07T20:52:00Z',
  'Not yet checked for API paths; validation pending before any ingestion.',
  10, 6000, false,
  'Metadata only in MVP.')
on conflict (firm_id, name) do nothing;

-- Enrichment providers: Lead Ocean is the planned primary; manual is always available.
insert into public.enrichment_providers (firm_id, provider_key, display_name, enabled, credential_secret_name, daily_cap, terms_url)
values
  ('0f000000-0000-4000-8000-000000000001', 'manual', 'Manual entry', true, null, 1000, null),
  ('0f000000-0000-4000-8000-000000000001', 'leadocean', 'Lead Ocean', false, 'LEADOCEAN_API_KEY', 100, 'https://leadocean.io/')
on conflict (firm_id, provider_key) do nothing;

select app.recompute_case_coverage('0c000000-0000-4000-8000-000000000001', 822);
