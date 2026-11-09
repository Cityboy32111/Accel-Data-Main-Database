-- Accel Case Intelligence: assertion layer and entity layer.

-- ---------------------------------------------------------------------------
-- Extractions: one row per LLM call, kept for reproducibility.
-- ---------------------------------------------------------------------------
create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  document_id uuid not null references public.source_documents (id) on delete cascade,
  page_from integer not null check (page_from >= 1),
  page_to integer not null check (page_to >= page_from),
  model text not null,
  prompt_version text not null,
  schema_version text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  raw_output jsonb,
  grounded_count integer not null default 0,
  rejected_count integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index extractions_doc_idx on public.extractions (document_id);

-- ---------------------------------------------------------------------------
-- Entities (canonical rows). Attributes shown in the dashboard are resolved
-- from assertions; these rows exist so the API can query them directly.
-- ---------------------------------------------------------------------------
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  kind app.entity_kind not null,
  canonical_name text not null,
  normalized_name text generated always as (
    lower(regexp_replace(canonical_name, '[^[:alnum:]]+', ' ', 'g'))
  ) stored,
  aliases text[] not null default '{}',
  party_roles app.party_role[] not null default '{}',
  is_individual boolean not null default false,
  resolution_cluster_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parties_case_idx on public.parties (case_id);
create index parties_name_trgm_idx on public.parties using gin (normalized_name extensions.gin_trgm_ops);
create trigger parties_touch before update on public.parties
  for each row execute function app.touch_updated_at();

-- Persons are individuals; organizations are not. Keep the flag honest.
create or replace function app.sync_is_individual()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_individual := (new.kind = 'person');
  return new;
end;
$$;
create trigger parties_individual before insert or update of kind on public.parties
  for each row execute function app.sync_is_individual();

create table public.attorneys (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  party_id uuid references public.parties (id) on delete set null,
  full_name text not null,
  law_firm text,
  bar_jurisdiction text,
  email text,
  phone text,
  represents_party_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index attorneys_case_idx on public.attorneys (case_id);
create trigger attorneys_touch before update on public.attorneys
  for each row execute function app.touch_updated_at();

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  receiver_property_number text,
  address text not null,
  normalized_address text generated always as (
    lower(regexp_replace(address, '[^[:alnum:]]+', ' ', 'g'))
  ) stored,
  city text,
  state text,
  parcel_identifier text,
  disposition app.property_disposition not null default 'unknown',
  sale_price numeric(16, 2),
  sale_approval_docket_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_case_idx on public.properties (case_id);
create index properties_addr_trgm_idx on public.properties using gin (normalized_address extensions.gin_trgm_ops);
create trigger properties_touch before update on public.properties
  for each row execute function app.touch_updated_at();

create table public.creditors (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  party_id uuid not null references public.parties (id) on delete cascade,
  creditor_type app.creditor_type not null default 'other',
  claim_amount_asserted numeric(16, 2),
  claim_group text,
  claim_set text,
  secured_property_ids uuid[] not null default '{}',
  treatment_summary text,
  is_individual boolean not null default false,
  enrichment_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, party_id)
);
create index creditors_case_idx on public.creditors (case_id);
create index creditors_type_idx on public.creditors (firm_id, creditor_type);
create trigger creditors_touch before update on public.creditors
  for each row execute function app.touch_updated_at();

-- Individuals are never enrichment targets; organizations are only when the
-- firm opts in per creditor. The flag is copied from the party so the directory
-- can filter without a join.
create or replace function app.sync_creditor_flags()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p public.parties%rowtype;
begin
  select * into p from public.parties where id = new.party_id;
  if not found then
    raise exception 'party % not found', new.party_id using errcode = 'foreign_key_violation';
  end if;
  if p.firm_id <> new.firm_id or p.case_id <> new.case_id then
    raise exception 'creditor and party must share firm and case' using errcode = 'check_violation';
  end if;
  new.is_individual := p.is_individual;
  if new.is_individual then
    new.enrichment_allowed := false;
  end if;
  return new;
end;
$$;
create trigger creditors_flags before insert or update on public.creditors
  for each row execute function app.sync_creditor_flags();

create table public.related_lawsuits (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  caption text not null,
  court text,
  docket_number text,
  relationship app.lawsuit_relationship not null default 'other',
  status text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index related_lawsuits_case_idx on public.related_lawsuits (case_id);
create trigger related_lawsuits_touch before update on public.related_lawsuits
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Assertions: one atomic fact, one entity, one page.
-- ---------------------------------------------------------------------------
create table public.assertions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  -- Exactly one subject reference is set; the subject_type names which.
  subject_type text not null check (subject_type in ('case', 'party', 'creditor', 'attorney', 'property', 'related_lawsuit')),
  subject_id uuid not null,
  predicate text not null,
  object_value jsonb,
  object_type text check (object_type is null or object_type in ('party', 'creditor', 'attorney', 'property', 'related_lawsuit')),
  object_id uuid,
  -- Citation. Required for extracted assertions; optional for others.
  source_document_id uuid references public.source_documents (id) on delete cascade,
  page_number integer check (page_number is null or page_number >= 1),
  quote text check (quote is null or length(quote) <= 500),
  char_start integer,
  char_end integer,
  -- Confidence and provenance.
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  origin app.assertion_origin not null,
  extraction_id uuid references public.extractions (id) on delete set null,
  enrichment_result_id uuid,
  -- Verification.
  verification_status app.verification_status not null default 'unverified',
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  verification_note text,
  corroborated_by_assertion_id uuid references public.assertions (id),
  superseded_by_assertion_id uuid references public.assertions (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Extracted facts must be anchored to a page with a verbatim quote.
  constraint assertions_extracted_need_citation check (
    origin <> 'extracted'
    or (source_document_id is not null and page_number is not null and quote is not null and length(quote) > 0)
  ),
  -- Enriched facts can only be confirmed when corroborated by a court-record assertion.
  constraint assertions_enriched_confirmation check (
    not (origin = 'enriched' and verification_status = 'confirmed')
    or corroborated_by_assertion_id is not null
  ),
  -- A confirmation or rejection records who and when.
  constraint assertions_verification_meta check (
    verification_status = 'unverified'
    or (verified_by is not null and verified_at is not null)
  )
);
create index assertions_subject_idx on public.assertions (subject_type, subject_id);
create index assertions_case_idx on public.assertions (case_id);
create index assertions_doc_page_idx on public.assertions (source_document_id, page_number);
create index assertions_status_idx on public.assertions (firm_id, verification_status, origin);
create trigger assertions_touch before update on public.assertions
  for each row execute function app.touch_updated_at();

-- The corroborating assertion must itself be a confirmed court-record fact in
-- the same case, and the cited document must belong to the same case.
create or replace function app.enforce_assertion_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  corr public.assertions%rowtype;
  doc public.source_documents%rowtype;
begin
  if new.source_document_id is not null then
    select * into doc from public.source_documents where id = new.source_document_id;
    if not found or doc.firm_id <> new.firm_id or doc.case_id <> new.case_id then
      raise exception 'cited document % is not in the same firm and case', new.source_document_id
        using errcode = 'check_violation';
    end if;
    if new.page_number is not null and doc.page_count is not null and new.page_number > doc.page_count then
      raise exception 'page % exceeds document page count %', new.page_number, doc.page_count
        using errcode = 'check_violation';
    end if;
  end if;
  if new.corroborated_by_assertion_id is not null then
    select * into corr from public.assertions where id = new.corroborated_by_assertion_id;
    if not found or corr.case_id <> new.case_id then
      raise exception 'corroborating assertion must be in the same case' using errcode = 'check_violation';
    end if;
    if corr.origin <> 'extracted' or corr.verification_status <> 'confirmed' then
      raise exception 'corroborating assertion % must be a confirmed court-record (extracted) assertion',
        corr.id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger assertions_integrity before insert or update on public.assertions
  for each row execute function app.enforce_assertion_integrity();

-- ---------------------------------------------------------------------------
-- Entity links and resolution decisions
-- ---------------------------------------------------------------------------
create table public.entity_links (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  from_type text not null,
  from_id uuid not null,
  predicate text not null,
  to_type text not null,
  to_id uuid not null,
  link_origin app.link_origin not null,
  supporting_assertion_ids uuid[] not null default '{}',
  confidence numeric(5, 4) not null default 1 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (from_type, from_id, predicate, to_type, to_id)
);
create index entity_links_from_idx on public.entity_links (from_type, from_id);
create index entity_links_to_idx on public.entity_links (to_type, to_id);

create table public.entity_resolution_decisions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  entity_type text not null,
  left_id uuid not null,
  right_id uuid not null,
  blocking_rule text not null,
  decision app.resolution_decision not null default 'undecided',
  decided_by app.decider,
  decider_user_id uuid references auth.users (id),
  model text,
  rationale text,
  score numeric(5, 4) check (score is null or score between 0 and 1),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (left_id <> right_id)
);
create index resolution_pair_idx on public.entity_resolution_decisions (entity_type, left_id, right_id);

-- ---------------------------------------------------------------------------
-- RLS: assertion and entity layers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'extractions', 'parties', 'attorneys', 'properties', 'creditors', 'related_lawsuits',
    'assertions', 'entity_links', 'entity_resolution_decisions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.is_firm_member(firm_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.has_firm_role(firm_id, array[''admin'',''reviewer'',''analyst'']::app.member_role[]))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.has_firm_role(firm_id, array[''admin'',''reviewer'',''analyst'']::app.member_role[])) with check (app.has_firm_role(firm_id, array[''admin'',''reviewer'',''analyst'']::app.member_role[]))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (app.has_firm_role(firm_id, array[''admin'',''reviewer'']::app.member_role[]))',
      t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end
$$;
