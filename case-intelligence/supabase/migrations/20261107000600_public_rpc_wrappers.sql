-- Public RPC wrappers. PostgREST exposes only the public schema, so the
-- workflow and coverage functions in schema app get thin public wrappers for
-- the Edge Functions and the dashboard. Permissions are enforced inside the
-- app functions (RLS plus role checks), not here.

create or replace function public.case_coverage(p_case_id uuid)
returns jsonb language sql stable set search_path = '' as $$ select app.case_coverage(p_case_id); $$;

create or replace function public.coverage_statement(p_case_id uuid)
returns text language sql stable set search_path = '' as $$ select app.coverage_statement(p_case_id); $$;

create or replace function public.recompute_case_coverage(p_case_id uuid, p_documents_known integer default null)
returns jsonb language sql set search_path = '' as $$ select app.recompute_case_coverage(p_case_id, p_documents_known); $$;

create or replace function public.confirm_assertion(p_assertion_id uuid, p_note text default null, p_corroborated_by uuid default null)
returns public.assertions language sql set search_path = '' as $$ select app.confirm_assertion(p_assertion_id, p_note, p_corroborated_by); $$;

create or replace function public.reject_assertion(p_assertion_id uuid, p_note text)
returns public.assertions language sql set search_path = '' as $$ select app.reject_assertion(p_assertion_id, p_note); $$;

create or replace function public.correct_assertion(p_assertion_id uuid, p_object_value jsonb, p_note text)
returns public.assertions language sql set search_path = '' as $$ select app.correct_assertion(p_assertion_id, p_object_value, p_note); $$;

create or replace function public.resolve_review_task(p_task_id uuid, p_resolution text, p_note text default null)
returns public.review_tasks language sql set search_path = '' as $$ select app.resolve_review_task(p_task_id, p_resolution, p_note); $$;

create or replace function public.record_audit_event(p_firm_id uuid, p_action text, p_table_name text, p_row_id text default null, p_details jsonb default null)
returns bigint language sql set search_path = '' as $$ select app.record_audit_event(p_firm_id, p_action, p_table_name, p_row_id, p_details); $$;

grant execute on function
  public.case_coverage(uuid), public.coverage_statement(uuid), public.recompute_case_coverage(uuid, integer),
  public.confirm_assertion(uuid, text, uuid), public.reject_assertion(uuid, text),
  public.correct_assertion(uuid, jsonb, text), public.resolve_review_task(uuid, text, text),
  public.record_audit_event(uuid, text, text, text, jsonb)
  to authenticated, service_role;
