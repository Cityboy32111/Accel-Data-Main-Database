-- PENDING: not applied in the 2026-11-08 regression pass (production kept out
-- of that pass). Adds the version-2 extraction fields to assertions so the
-- dashboard can show filing, proceeding and legal status together.

create type app.assertion_modality as enum
  ('ordered', 'approved', 'completed', 'reported', 'proposed', 'requested', 'recommended', 'alleged', 'argued', 'index_reference');

alter table public.assertions
  add column modality app.assertion_modality,
  add column conditions text,
  add column proceeding_type text check (proceeding_type is null or proceeding_type in ('main_case', 'related_lawsuit')),
  add column proceeding_id uuid references public.related_lawsuits (id) on delete set null,
  add column as_of_date date,
  add column referenced_page integer,
  add column lint_flags text[] not null default '{}';

-- Index references may never be confirmed as facts: a reviewer must confirm
-- the substantive page instead.
alter table public.assertions add constraint assertions_index_reference_unconfirmable
  check (not (modality = 'index_reference' and verification_status = 'confirmed'));

comment on column public.assertions.modality is 'Legal status of the fact as the filing states it; never upgrade a request to an outcome.';
