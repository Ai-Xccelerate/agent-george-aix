-- Cadence schedule per customer (backlog #23). HLR §2.2–§2.4 calls for
-- structured cadence (weekly / biweekly / etc.) at the partner level so we
-- can drive prep, reminders, and deck generation off it instead of scraping
-- calendars. One active cadence row per customer; previous schedules become
-- inactive rather than getting deleted, so history is auditable.

create type cadence_frequency as enum (
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'ad_hoc'        -- explicit "we don't have a regular schedule"
);

create type cadence_channel as enum (
  'call',         -- Teams / Zoom / Meet
  'in_person',
  'email',
  'async'
);

create table public.cadences (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  org_id          uuid not null references public.orgs(id) on delete cascade,
  frequency       cadence_frequency not null,
  -- 0 = Sunday … 6 = Saturday (matches Date.getDay()). NULL for ad_hoc.
  day_of_week     smallint check (day_of_week is null or day_of_week between 0 and 6),
  time_of_day     time,                              -- local to `timezone`
  timezone        text,                              -- IANA, falls back to org default
  channel         cadence_channel not null default 'call',
  duration_min    smallint check (duration_min is null or (duration_min > 0 and duration_min <= 480)),
  owner_user_id   uuid references auth.users(id) on delete set null,  -- internal CSM owner of this cadence
  last_met_at     timestamptz,
  next_meeting_at timestamptz,
  active          boolean not null default true,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index cadences_customer_idx
  on public.cadences (customer_id, active);
create index cadences_org_next_idx
  on public.cadences (org_id, next_meeting_at)
  where active;

-- Only one active cadence per customer at a time. Old ones get `active=false`
-- when superseded so we keep history.
create unique index cadences_one_active_per_customer
  on public.cadences (customer_id)
  where active;

create trigger trg_cadences_updated_at
  before update on public.cadences
  for each row execute function public.set_updated_at();

alter table public.cadences enable row level security;

create policy cadences_select on public.cadences
  for select using (public.is_org_member(org_id));
create policy cadences_insert on public.cadences
  for insert with check (public.is_org_member(org_id));
create policy cadences_update on public.cadences
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy cadences_delete on public.cadences
  for delete using (public.is_org_member(org_id));
