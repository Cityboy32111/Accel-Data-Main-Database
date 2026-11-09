-- Accel Case Intelligence: enrichment, review queue, audit log, pipeline jobs.

-- ---------------------------------------------------------------------------
-- Enrichment providers (per firm). Lead Ocean is the planned primary provider.
-- The credential is referenced by secret name only; values never live here.
-- ---------------------------------------------------------------------------
create table public.enrichment_providers (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  provider_key text not null check (provider_key in ('manual', 'leadocean', 'apollo', 'leadmagic', 'clay')),
  display_name text not null,
  enabled boolean not null default false,
  credential_secret_name text,
  allowed_entity_kinds app.entity_kind[] not null default array['organization']::app.entity_kind[],
  daily_cap integer not null default 100 check (daily_cap >= 0),
  cost_per_lookup numeric(10, 4),
  terms_url text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, provider_key),
  -- Individuals are never enrichment targets in this system.
  constraint enrichment_orgs_only check (not ('person'::app.entity_kind = any (allowed_entity_kinds)))
);
create trigger enrichment_providers_touch before update on public.enrichment_providers
  for each row execute function app.touch_updated_at();

create table public.enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  provider_id uuid not null references public.enrichment_providers (id),
  subject_type text not null check (subject_type in ('party', 'creditor', 'attorney')),
  subject_id uuid not null,
  requested_by uuid references auth.users (id),
  status app.job_status not null default 'queued',
  request_payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index enrichment_jobs_subject_idx on public.enrichment_jobs (subject_type, subject_id);

create table public.enrichment_results (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  job_id uuid not null references public.enrichment_jobs (id) on delete cascade,
  provider_id uuid not null references public.enrichment_providers (id),
  subject_type text not null,
  subject_id uuid not null,
  raw_response jsonb,
  normalized jsonb not null default '{}'::jsonb,
  provider_confidence numeric(5, 4) check (provider_confidence is null or provider_confidence between 0 and 1),
  retrieved_at timestamptz not null default now()
);
create index enrichment_results_subject_idx on public.enrichment_results (subject_type, subject_id);

alter table public.assertions
  add constraint assertions_enrichment_result_fk
  foreign key (enrichment_result_id) references public.enrichment_results (id) on delete set null;

-- Refuse enrichment of individuals at the database layer, whatever the caller.
create or replace function app.enforce_enrichment_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_person boolean;
  prov public.enrichment_providers%rowtype;
begin
  select * into prov from public.enrichment_providers where id = new.provider_id;
  if not found or prov.firm_id <> new.firm_id then
    raise exception 'enrichment provider % not available to this firm', new.provider_id
      using errcode = 'check_violation';
  end if;
  if not prov.enabled then
    raise exception 'enrichment provider % is disabled', prov.provider_key using errcode = 'check_violation';
  end if;
  if new.subject_type = 'party' then
    select p.is_individual into is_person from public.parties p where p.id = new.subject_id and p.firm_id = new.firm_id;
  elsif new.subject_type = 'creditor' then
    select c.is_individual into is_person from public.creditors c where c.id = new.subject_id and c.firm_id = new.firm_id;
  elsif new.subject_type = 'attorney' then
    -- Attorneys are professionals acting in a representative capacity; their
    -- firm (an organization) is the enrichment target, never the person.
    is_person := true;
  end if;
  if is_person is null then
    raise exception 'enrichment subject %/% not found in firm', new.subject_type, new.subject_id
      using errcode = 'check_violation';
  end if;
  if is_person then
    raise exception 'enrichment of individuals is not permitted' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger enrichment_jobs_target before insert on public.enrichment_jobs
  for each row execute function app.enforce_enrichment_target();

-- ---------------------------------------------------------------------------
-- Review tasks
-- ---------------------------------------------------------------------------
create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid references public.cases (id) on delete cascade,
  task_type app.review_task_type not null,
  priority smallint not null default 3 check (priority between 1 and 5),
  status app.review_task_status not null default 'open',
  title text not null,
  details jsonb not null default '{}'::jsonb,
  assertion_id uuid references public.assertions (id) on delete cascade,
  document_id uuid references public.source_documents (id) on delete cascade,
  resolution_decision_id uuid references public.entity_resolution_decisions (id) on delete cascade,
  assigned_to uuid references auth.users (id),
  resolved_by uuid references auth.users (id),
  resolution text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index review_tasks_open_idx on public.review_tasks (firm_id, status, priority);
create trigger review_tasks_touch before update on public.review_tasks
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log: append-only, trigger-fed, never updated or deleted by any role
-- except a retention job that sets app.audit_retention = 'on'.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  firm_id uuid,
  actor_id uuid,
  actor_role text,
  action text not null,
  table_name text not null,
  row_id text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  occurred_at timestamptz not null default now()
);
create index audit_log_firm_time_idx on public.audit_log (firm_id, occurred_at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);

create or replace function app.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  fid uuid;
  rid text;
  before_j jsonb;
  after_j jsonb;
begin
  if tg_op = 'DELETE' then
    before_j := to_jsonb(old);
    fid := nullif(before_j ->> 'firm_id', '')::uuid;
    rid := before_j ->> 'id';
  elsif tg_op = 'UPDATE' then
    before_j := to_jsonb(old);
    after_j := to_jsonb(new);
    fid := nullif(after_j ->> 'firm_id', '')::uuid;
    rid := after_j ->> 'id';
    -- Only store changed keys from before, to keep the log compact.
    before_j := (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from jsonb_each(before_j) b
      where after_j -> b.key is distinct from b.value
    );
    after_j := (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from jsonb_each(after_j) a
      where to_jsonb(old) -> a.key is distinct from a.value
    );
  else
    after_j := to_jsonb(new);
    fid := nullif(after_j ->> 'firm_id', '')::uuid;
    rid := after_j ->> 'id';
  end if;

  -- Never persist page text or raw model output in the audit trail.
  if tg_table_name in ('document_pages') then
    before_j := before_j - 'text';
    after_j := after_j - 'text';
  end if;
  if tg_table_name in ('extractions', 'enrichment_results') then
    before_j := before_j - 'raw_output' - 'raw_response';
    after_j := after_j - 'raw_output' - 'raw_response';
  end if;

  insert into public.audit_log (firm_id, actor_id, actor_role, action, table_name, row_id, before_data, after_data, request_id)
  values (
    fid,
    auth.uid(),
    coalesce(current_setting('request.jwt.claim.role', true), current_user),
    lower(tg_op),
    tg_table_name,
    rid,
    before_j,
    after_j,
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id'
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.audit_retention', true), '') = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.audit_log_is_append_only();

-- Explicit API-level audit events (sensitive reads, exports, approvals).
create or replace function app.record_audit_event(
  p_firm_id uuid, p_action text, p_table_name text, p_row_id text default null, p_details jsonb default null)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  new_id bigint;
begin
  if not app.is_firm_member(p_firm_id) and current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and current_user <> 'postgres' then
    raise exception 'not a member of firm %', p_firm_id using errcode = 'insufficient_privilege';
  end if;
  insert into public.audit_log (firm_id, actor_id, actor_role, action, table_name, row_id, after_data)
  values (p_firm_id, auth.uid(), coalesce(current_setting('request.jwt.claim.role', true), current_user),
          p_action, p_table_name, p_row_id, p_details)
  returning id into new_id;
  return new_id;
end;
$$;
grant execute on function app.record_audit_event(uuid, text, text, text, jsonb) to authenticated, service_role;

-- Attach the audit trigger to every tenant table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'firms', 'firm_members', 'sources', 'cases', 'upload_attestations', 'source_documents',
    'document_pages', 'extractions', 'parties', 'attorneys', 'properties', 'creditors',
    'related_lawsuits', 'assertions', 'entity_links', 'entity_resolution_decisions',
    'enrichment_providers', 'enrichment_jobs', 'enrichment_results', 'review_tasks'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row_change()',
      t || '_audit', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Pipeline jobs: worker queue table (claimed with a lease).
-- ---------------------------------------------------------------------------
create table public.pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  case_id uuid references public.cases (id) on delete cascade,
  job_type text not null check (job_type in ('acquire', 'screen', 'extract_text', 'structure', 'resolve', 'enrich', 'publish')),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status app.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  leased_until timestamptz,
  leased_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index pipeline_jobs_dedupe_idx on public.pipeline_jobs (dedupe_key) where dedupe_key is not null and status in ('queued', 'leased');
create index pipeline_jobs_queue_idx on public.pipeline_jobs (status, created_at) where status = 'queued';
create trigger pipeline_jobs_touch before update on public.pipeline_jobs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.enrichment_providers enable row level security;
alter table public.enrichment_jobs enable row level security;
alter table public.enrichment_results enable row level security;
alter table public.review_tasks enable row level security;
alter table public.audit_log enable row level security;
alter table public.pipeline_jobs enable row level security;

create policy enrichment_providers_select on public.enrichment_providers for select to authenticated
  using (app.is_firm_member(firm_id));
create policy enrichment_providers_admin on public.enrichment_providers for all to authenticated
  using (app.has_firm_role(firm_id, array['admin']::app.member_role[]))
  with check (app.has_firm_role(firm_id, array['admin']::app.member_role[]));

create policy enrichment_jobs_select on public.enrichment_jobs for select to authenticated
  using (app.is_firm_member(firm_id));
create policy enrichment_jobs_insert on public.enrichment_jobs for insert to authenticated
  with check (requested_by = auth.uid()
    and app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]));

create policy enrichment_results_select on public.enrichment_results for select to authenticated
  using (app.is_firm_member(firm_id));
-- Results are written only by the worker (service role).

create policy review_tasks_select on public.review_tasks for select to authenticated
  using (app.is_firm_member(firm_id));
create policy review_tasks_insert on public.review_tasks for insert to authenticated
  with check (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]));
create policy review_tasks_update on public.review_tasks for update to authenticated
  using (app.has_firm_role(firm_id, array['admin', 'reviewer']::app.member_role[]))
  with check (app.has_firm_role(firm_id, array['admin', 'reviewer']::app.member_role[]));

-- Audit log is readable by firm admins only; nobody inserts directly through the API.
create policy audit_log_admin_select on public.audit_log for select to authenticated
  using (firm_id is not null and app.has_firm_role(firm_id, array['admin']::app.member_role[]));

create policy pipeline_jobs_select on public.pipeline_jobs for select to authenticated
  using (app.is_firm_member(firm_id));
create policy pipeline_jobs_insert on public.pipeline_jobs for insert to authenticated
  with check (app.has_firm_role(firm_id, array['admin', 'reviewer', 'analyst']::app.member_role[]));

grant select, insert, update, delete on public.enrichment_providers to authenticated;
grant select, insert on public.enrichment_jobs to authenticated;
grant select on public.enrichment_results to authenticated;
grant select, insert, update on public.review_tasks to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert on public.pipeline_jobs to authenticated;
grant all on public.enrichment_providers, public.enrichment_jobs, public.enrichment_results,
  public.review_tasks, public.audit_log, public.pipeline_jobs to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;
