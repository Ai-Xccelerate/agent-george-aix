-- Standing jobs — George runs scheduled tasks autonomously without a human
-- typing in chat (backlog item #16; HLR §9). Two tables: the job spec, and a
-- per-execution log row that captures what happened.

create type agent_job_run_status as enum (
  'pending',     -- claimed by the runner, work not yet started
  'running',     -- George is executing
  'succeeded',
  'failed',
  'timed_out'
);

create type agent_job_run_trigger as enum (
  'schedule',    -- cron tick fired this run
  'manual'       -- a human hit "Run now"
);

create table public.agent_jobs (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  name            text not null,
  directive       text not null,            -- natural-language prompt for George
  cron            text not null,            -- standard 5-field cron expression
  timezone        text,                     -- IANA, falls back to orgs.default_timezone
  customer_id     uuid references public.customers(id) on delete set null,
  enabled         boolean not null default true,
  running_run_id  uuid,                     -- atomic claim guard; null when idle
  last_run_at     timestamptz,
  next_run_at     timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.agent_jobs (org_id);
create index on public.agent_jobs (enabled, next_run_at) where enabled;

create trigger trg_agent_jobs_updated_at
  before update on public.agent_jobs
  for each row execute function public.set_updated_at();

create table public.agent_job_runs (
  id              uuid primary key default uuid_generate_v4(),
  job_id          uuid not null references public.agent_jobs(id) on delete cascade,
  org_id          uuid not null references public.orgs(id) on delete cascade,
  status          agent_job_run_status not null default 'pending',
  trigger         agent_job_run_trigger not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  summary         text,                     -- George's final assistant text
  error           text,
  sdk_session_id  text,
  triggered_by    uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index on public.agent_job_runs (job_id, started_at desc);
create index on public.agent_job_runs (org_id, started_at desc);

-- Now that agent_job_runs exists, add the FK from agent_jobs.running_run_id.
alter table public.agent_jobs
  add constraint agent_jobs_running_run_id_fkey
    foreign key (running_run_id) references public.agent_job_runs(id) on delete set null;

-- ---------------------------------------------------------------------
-- RLS — members read; admins write (service-role bypasses RLS anyway).
-- ---------------------------------------------------------------------
alter table public.agent_jobs     enable row level security;
alter table public.agent_job_runs enable row level security;

create policy agent_jobs_select on public.agent_jobs
  for select using (public.is_org_member(org_id));
create policy agent_jobs_admin_insert on public.agent_jobs
  for insert with check (public.is_org_admin(org_id));
create policy agent_jobs_admin_update on public.agent_jobs
  for update using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));
create policy agent_jobs_admin_delete on public.agent_jobs
  for delete using (public.is_org_admin(org_id));

create policy agent_job_runs_select on public.agent_job_runs
  for select using (public.is_org_member(org_id));
-- Inserts/updates flow through the service-role runner; no auth-side write policy.
