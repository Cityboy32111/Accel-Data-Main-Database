-- Accel Case Intelligence: cases and the evidence layer.
-- sources, cases, upload_attestations, source_documents, document_pages.

-- ---------------------------------------------------------------------------
-- Source registry. Ingestion refuses any source not in 'validated'.
-- ---------------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  name text not null,
  kind app.source_kind not null,
  base_url text,
  access_class text not null default 'public_no_login',
  status app.source_status not null default 'proposed',
  legal_basis text,
  terms_url text,
  terms_reviewed_at timestamptz,
  terms_notes text,
  robots_checked_at timestamptz,
  robots_result text,
  access_test_at timestamptz,
  access_test_result jsonb,
  restriction_markers text[] not null default array[
    'SEALED', 'FILED UNDER SEAL', 'UNDER SEAL', 'CONFIDENTIAL', 'PROTECTIVE ORDER', 'RESTRICTED'
  ],
  rate_limit_per_minute integer not null default 20 check (rate_limit_per_minute between 1 and 600),
  min_delay_ms integer not null default 3000 check (min_delay_ms >= 500),
  store_copy boolean not null default true,
  sensitivity_notes text,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  revalidate_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, name)
);
comment on table public.sources is 'Source registry with validation checklist evidence. See docs/02-source-access-validation.md.';

-- A source may only move to validated when the checklist evidence is present.
create or replace function app.enforce_source_validation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'validated' then
    if new.legal_basis is null or new.terms_reviewed_at is null
       or new.access_test_at is null or new.approved_by is null then
      raise exception 'source % cannot be validated without legal_basis, terms_reviewed_at, access_test_at and approved_by', new.id
        using errcode = 'check_violation';
    end if;
    if new.kind in ('public_web', 'court_mirror') and new.robots_checked_at is null then
      raise exception 'web source % cannot be validated without a robots.txt check', new.id
        using errcode = 'check_violation';
    end if;
    if new.approved_at is null then
      new.approved_at := now();
    end if;
    if new.revalidate_after is null then
      new.revalidate_after := now() + interval '90 days';
    end if;
  end if;
  return new;
end;
$$;
create trigger sources_validation before insert or update on public.sources
  for each row execute function app.enforce_source_validation();
create trigger sources_touch before update on public.sources
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  caption text not null,
  short_name text,
  court text,
  docket_number text,
  judge text,
  receiver_name text,
  receiver_firm text,
  appointment_date date,
  case_type text not null default 'receivership',
  status text not null default 'active',
  summary text,
  -- Computed by app.recompute_case_coverage(); never hand-written.
  coverage jsonb not null default jsonb_build_object(
    'documents_known_at_source', 0, 'documents_acquired', 0,
    'documents_processed', 0, 'last_processed_at', null, 'is_complete', false),
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(caption, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(docket_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(court, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(receiver_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, docket_number, court)
);
create index cases_firm_idx on public.cases (firm_id);
create index cases_search_idx on public.cases using gin (search_vector);
create trigger cases_touch before update on public.cases
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Upload attestations: required before any authorized upload is accepted.
-- ---------------------------------------------------------------------------
create table public.upload_attestations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  uploader_id uuid not null references auth.users (id),
  attestation_version text not null,
  attestation_text text not null,
  authorized_to_possess boolean not null,
  authorized_to_process boolean not null,
  not_sealed boolean not null,
  no_protective_order_bar boolean not null,
  privileged boolean not null default false,
  notes text,
  accepted_at timestamptz not null default now(),
  check (authorized_to_possess and authorized_to_process and not_sealed and no_protective_order_bar)
);
create index upload_attestations_case_idx on public.upload_attestations (case_id);

-- ---------------------------------------------------------------------------
-- Source documents
-- ---------------------------------------------------------------------------
create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  source_id uuid not null references public.sources (id),
  upload_attestation_id uuid references public.upload_attestations (id),
  original_url text,
  storage_bucket text not null default 'source-documents',
  storage_path text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint,
  mime_type text not null default 'application/pdf',
  title text not null,
  document_category app.document_category not null default 'other',
  docket_number text,
  docket_suffix text,
  filed_date date,
  page_count integer,
  processing_status app.processing_status not null default 'acquired',
  restriction_flags text[] not null default '{}',
  screening_notes text,
  privileged boolean not null default false,
  acquired_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, case_id, sha256)
);
create index source_documents_case_idx on public.source_documents (case_id);
create index source_documents_status_idx on public.source_documents (firm_id, processing_status);
create index source_documents_docket_idx on public.source_documents (case_id, docket_number);
create trigger source_documents_touch before update on public.source_documents
  for each row execute function app.touch_updated_at();

-- Documents may only be attached to validated sources, and uploads need an
-- attestation whose case and firm match. Privileged uploads inherit the flag.
create or replace function app.enforce_document_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src public.sources%rowtype;
  att public.upload_attestations%rowtype;
begin
  select * into src from public.sources where id = new.source_id;
  if not found then
    raise exception 'source % not found', new.source_id using errcode = 'foreign_key_violation';
  end if;
  if src.firm_id <> new.firm_id then
    raise exception 'source % belongs to another firm', new.source_id using errcode = 'check_violation';
  end if;
  if src.status <> 'validated' then
    raise exception 'source % is not validated (status %)', new.source_id, src.status
      using errcode = 'check_violation';
  end if;
  if src.kind = 'authorized_upload' then
    if new.upload_attestation_id is null then
      raise exception 'uploaded document requires an upload_attestation_id' using errcode = 'check_violation';
    end if;
    select * into att from public.upload_attestations where id = new.upload_attestation_id;
    if not found or att.firm_id <> new.firm_id or att.case_id <> new.case_id then
      raise exception 'upload attestation % does not match document firm/case', new.upload_attestation_id
        using errcode = 'check_violation';
    end if;
    new.privileged := att.privileged;
    if new.document_category = 'other' then
      new.document_category := 'upload';
    end if;
  end if;
  return new;
end;
$$;
create trigger source_documents_provenance before insert or update of source_id, upload_attestation_id
  on public.source_documents
  for each row execute function app.enforce_document_provenance();

-- ---------------------------------------------------------------------------
-- Document pages
-- ---------------------------------------------------------------------------
create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  document_id uuid not null references public.source_documents (id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  text text not null default '',
  text_method app.text_method not null default 'none',
  char_count integer generated always as (length(text)) stored,
  ocr_confidence numeric(5, 4) check (ocr_confidence is null or ocr_confidence between 0 and 1),
  pii_masked boolean not null default false,
  text_sha256 text,
  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);
create index document_pages_doc_idx on public.document_pages (document_id);
create index document_pages_text_idx on public.document_pages using gin (to_tsvector('english', text));

-- ---------------------------------------------------------------------------
-- RLS: evidence layer
-- ---------------------------------------------------------------------------
alter table public.sources enable row level security;
alter table public.cases enable row level security;
alter table public.upload_attestations enable row level security;
alter table public.source_documents enable row level security;
alter table public.document_pages enable row level security;

-- sources: members read; admins manage (approval is an admin act).
create policy sources_select on public.sources for select to authenticated
  using (app.is_firm_member(firm_id));
create policy sources_admin_write on public.sources for all to authenticated
  using (app.has_firm_role(firm_id, array['admin']::app.member_role[]))
  with check (app.has_firm_role(firm_id, array['admin']::app.member_role[]));

-- cases: members read; analysts and above write.
create policy cases_select on public.cases for select to authenticated
  using (app.is_firm_member(firm_id));
create policy cases_write on public.cases for all to authenticated
  using (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]))
  with check (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]));

-- attestations: members read; the uploader records their own attestation.
create policy upload_attestations_select on public.upload_attestations for select to authenticated
  using (app.is_firm_member(firm_id));
create policy upload_attestations_insert on public.upload_attestations for insert to authenticated
  with check (
    uploader_id = auth.uid()
    and app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[])
  );

-- documents and pages: members read (privileged docs only for reviewer/admin); analysts and above write.
create policy source_documents_select on public.source_documents for select to authenticated
  using (
    app.is_firm_member(firm_id)
    and (not privileged or app.has_firm_role(firm_id, array['admin', 'reviewer']::app.member_role[]))
  );
create policy source_documents_write on public.source_documents for all to authenticated
  using (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]))
  with check (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]));

create policy document_pages_select on public.document_pages for select to authenticated
  using (
    app.is_firm_member(firm_id)
    and exists (
      select 1 from public.source_documents d
      where d.id = document_id
        and (not d.privileged or app.has_firm_role(d.firm_id, array['admin', 'reviewer']::app.member_role[]))
    )
  );
create policy document_pages_write on public.document_pages for all to authenticated
  using (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]))
  with check (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]));

grant select, insert, update, delete on
  public.sources, public.cases, public.upload_attestations, public.source_documents, public.document_pages
  to authenticated;
grant all on
  public.sources, public.cases, public.upload_attestations, public.source_documents, public.document_pages
  to service_role;
