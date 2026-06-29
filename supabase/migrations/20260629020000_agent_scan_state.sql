-- Throttle state for George's periodic proactive scans.
--
-- The cron tick wakes George to sweep the book (upcoming meetings, new
-- transcripts, renewal/health, untouched accounts) on a cadence. This table
-- records when each org's scan of a given `kind` last ran, so the tick can
-- skip orgs that aren't due yet — the same throttle shape the mailbox /
-- transcript mirrors use, but those key off their data tables; a scan has no
-- natural data row to key off, so it gets its own marker.

create table public.agent_scan_state (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  kind        text not null,                 -- e.g. 'proactive'
  last_run_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (org_id, kind)
);

create trigger trg_agent_scan_state_updated_at
  before update on public.agent_scan_state
  for each row execute function public.set_updated_at();

alter table public.agent_scan_state enable row level security;

create policy agent_scan_state_select on public.agent_scan_state
  for select using (public.is_org_member(org_id));
