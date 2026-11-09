-- Accel Case Intelligence: foundation.
-- Extensions, the app helper schema, enumerations, and tenancy tables.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type app.member_role as enum ('admin', 'reviewer', 'analyst', 'readonly');

create type app.source_kind as enum ('public_web', 'court_mirror', 'authorized_upload');
create type app.source_status as enum ('proposed', 'validated', 'suspended');

create type app.document_category as enum
  ('order', 'status_report', 'claims_process', 'pleading', 'exhibit', 'upload', 'other');
create type app.processing_status as enum
  ('acquired', 'screened', 'halted_restricted', 'text_extracted', 'structured', 'published', 'failed');
create type app.text_method as enum ('text_layer', 'ocr', 'none');

create type app.assertion_origin as enum ('extracted', 'inferred', 'enriched', 'manual');
create type app.verification_status as enum ('unverified', 'confirmed', 'rejected', 'superseded');

create type app.entity_kind as enum ('person', 'organization');
create type app.party_role as enum
  ('plaintiff', 'defendant', 'relief_defendant', 'receiver', 'intervenor', 'objector',
   'claimant', 'purchaser', 'lender', 'counsel', 'court', 'other');
create type app.creditor_type as enum
  ('institutional_lender', 'secured_lender', 'investor_lender', 'trade_creditor',
   'taxing_authority', 'professional', 'other');
create type app.property_disposition as enum ('held', 'marketed', 'sold', 'foreclosed', 'unknown');
create type app.lawsuit_relationship as enum
  ('appeal', 'state_court_action', 'adversary', 'foreclosure', 'enforcement', 'other');
create type app.link_origin as enum ('extracted', 'inferred', 'manual');
create type app.resolution_decision as enum ('merge', 'distinct', 'undecided');
create type app.decider as enum ('rule', 'llm', 'reviewer');

create type app.review_task_type as enum
  ('low_confidence_assertion', 'entity_resolution', 'restricted_document',
   'enrichment_conflict', 'upload_screening', 'manual');
create type app.review_task_status as enum ('open', 'in_progress', 'resolved', 'dismissed');
create type app.job_status as enum ('queued', 'leased', 'succeeded', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.firms is 'Tenant: one row per law firm.';

create table public.firm_members (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app.member_role not null default 'readonly',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, user_id)
);
create index firm_members_user_idx on public.firm_members (user_id);
comment on table public.firm_members is 'Maps an auth user to a firm with a role.';

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS policies. SECURITY DEFINER so policies can
-- consult firm_members without recursing through its own policy.
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select auth.uid();
$$;

create or replace function app.user_firm_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select fm.firm_id
  from public.firm_members fm
  where fm.user_id = auth.uid();
$$;
revoke all on function app.user_firm_ids() from public;
grant execute on function app.user_firm_ids() to authenticated, service_role;

create or replace function app.has_firm_role(target_firm uuid, allowed app.member_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.firm_members fm
    where fm.user_id = auth.uid()
      and fm.firm_id = target_firm
      and fm.role = any (allowed)
  );
$$;
revoke all on function app.has_firm_role(uuid, app.member_role[]) from public;
grant execute on function app.has_firm_role(uuid, app.member_role[]) to authenticated, service_role;

create or replace function app.is_firm_member(target_firm uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.firm_members fm
    where fm.user_id = auth.uid() and fm.firm_id = target_firm
  );
$$;
revoke all on function app.is_firm_member(uuid) from public;
grant execute on function app.is_firm_member(uuid) to authenticated, service_role;

-- Generic updated_at maintenance.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger firms_touch before update on public.firms
  for each row execute function app.touch_updated_at();
create trigger firm_members_touch before update on public.firm_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS for tenancy tables
-- ---------------------------------------------------------------------------
alter table public.firms enable row level security;
alter table public.firm_members enable row level security;

create policy firms_select on public.firms
  for select to authenticated
  using (app.is_firm_member(id));

create policy firms_update on public.firms
  for update to authenticated
  using (app.has_firm_role(id, array['admin']::app.member_role[]))
  with check (app.has_firm_role(id, array['admin']::app.member_role[]));

-- Firm creation is a service-role operation (onboarding), not a user action.

create policy firm_members_select on public.firm_members
  for select to authenticated
  using (app.is_firm_member(firm_id));

create policy firm_members_admin_insert on public.firm_members
  for insert to authenticated
  with check (app.has_firm_role(firm_id, array['admin']::app.member_role[]));

create policy firm_members_admin_update on public.firm_members
  for update to authenticated
  using (app.has_firm_role(firm_id, array['admin']::app.member_role[]))
  with check (app.has_firm_role(firm_id, array['admin']::app.member_role[]));

create policy firm_members_admin_delete on public.firm_members
  for delete to authenticated
  using (app.has_firm_role(firm_id, array['admin']::app.member_role[]));

grant select, insert, update, delete on public.firms, public.firm_members to authenticated;
grant all on public.firms, public.firm_members to service_role;
