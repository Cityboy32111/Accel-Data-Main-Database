-- The normalized-name generated columns kept a trailing space when a name ended
-- in punctuation ("EquityBuild, Inc." -> "equitybuild inc "), so within-case
-- entity matching never found existing rows and created duplicates. Trim them.

alter table public.parties drop column normalized_name;
alter table public.parties add column normalized_name text generated always as (
  btrim(lower(regexp_replace(canonical_name, '[^[:alnum:]]+', ' ', 'g')))
) stored;
create index parties_name_trgm_idx on public.parties using gin (normalized_name extensions.gin_trgm_ops);
create index parties_case_norm_idx on public.parties (case_id, normalized_name);

alter table public.properties drop column normalized_address;
alter table public.properties add column normalized_address text generated always as (
  btrim(lower(regexp_replace(address, '[^[:alnum:]]+', ' ', 'g')))
) stored;
create index properties_addr_trgm_idx on public.properties using gin (normalized_address extensions.gin_trgm_ops);
create index properties_case_norm_idx on public.properties (case_id, normalized_address);

-- Merge exact-normalized duplicate parties within a case: keep the earliest row,
-- re-point every reference, union roles and aliases, then remove the extras.
create or replace function app.merge_duplicate_parties(p_case_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  grp record;
  keeper uuid;
  removed integer := 0;
begin
  for grp in
    select normalized_name, array_agg(id order by created_at, id) as ids
    from public.parties where case_id = p_case_id
    group by normalized_name having count(*) > 1
  loop
    keeper := grp.ids[1];
    update public.parties k
       set party_roles = (select array_agg(distinct r) from public.parties d, unnest(d.party_roles) r where d.id = any (grp.ids)),
           aliases = coalesce((select array_agg(distinct a) from public.parties d, unnest(d.aliases) a where d.id = any (grp.ids) and a <> k.canonical_name), '{}')
     where k.id = keeper;
    update public.assertions set subject_id = keeper where subject_type = 'party' and subject_id = any (grp.ids[2:]);
    update public.assertions set object_id = keeper where object_type = 'party' and object_id = any (grp.ids[2:]);
    update public.attorneys set party_id = keeper where party_id = any (grp.ids[2:]);
    update public.attorneys set represents_party_ids = (
      select coalesce(array_agg(distinct case when x = any (grp.ids[2:]) then keeper else x end), '{}') from unnest(represents_party_ids) x)
     where represents_party_ids && grp.ids[2:];
    update public.entity_links set from_id = keeper where from_type = 'party' and from_id = any (grp.ids[2:]);
    update public.entity_links set to_id = keeper where to_type = 'party' and to_id = any (grp.ids[2:]);
    -- Creditors: keep the keeper's creditor row if one exists, else re-point the first duplicate's.
    if exists (select 1 from public.creditors where party_id = keeper) then
      update public.assertions a set subject_id = (select id from public.creditors where party_id = keeper)
       where a.subject_type = 'creditor' and a.subject_id in (select id from public.creditors where party_id = any (grp.ids[2:]));
      delete from public.creditors where party_id = any (grp.ids[2:]);
    else
      update public.creditors set party_id = keeper where id = (select id from public.creditors where party_id = any (grp.ids[2:]) order by created_at limit 1);
      delete from public.creditors where party_id = any (grp.ids[2:]);
    end if;
    insert into public.entity_resolution_decisions (firm_id, case_id, entity_type, left_id, right_id, blocking_rule, decision, decided_by, rationale, score, decided_at)
    select p.firm_id, p_case_id, 'party', keeper, d, 'exact_normalized_name', 'merge', 'rule', 'identical normalized name within case', 1.0, now()
    from unnest(grp.ids[2:]) d, public.parties p where p.id = keeper;
    delete from public.parties where id = any (grp.ids[2:]);
    removed := removed + array_length(grp.ids, 1) - 1;
  end loop;
  return removed;
end;
$$;
grant execute on function app.merge_duplicate_parties(uuid) to service_role;
