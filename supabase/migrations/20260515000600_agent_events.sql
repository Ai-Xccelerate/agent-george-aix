-- ---------------------------------------------------------------------
-- agent_events
--
-- Inbound triggers that George processes autonomously. Today: Composio
-- OUTLOOK_NEW_MESSAGE webhooks (backlog #1). Tomorrow: Fireflies
-- TRANSCRIPT_READY, manual replays, scheduled imports, etc.
--
-- Lifecycle:
--   pending     – just landed, not yet processed
--   processing  – a runner has claimed it
--   processed   – George ran successfully (session_id holds the chat
--                 session the user can review)
--   failed      – the run errored
--   skipped     – intentionally not run (dedupe hit, unknown event type,
--                 unwired org, etc.)
--
-- Dedupe: (org_id, source, source_event_id) is unique when source_event_id
-- is non-null. That tolerates retries from Composio for the same delivery
-- without re-running George.
-- ---------------------------------------------------------------------

create type agent_event_status as enum (
  'pending',
  'processing',
  'processed',
  'failed',
  'skipped'
);

create table public.agent_events (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  source          text not null,                        -- 'composio' | 'manual' | …
  source_event_id text,                                 -- Composio delivery id, if any
  event_type      text not null,                        -- e.g. 'OUTLOOK_NEW_MESSAGE'
  payload         jsonb not null default '{}'::jsonb,
  status          agent_event_status not null default 'pending',
  session_id      uuid references public.agent_sessions(id) on delete set null,
  error           text,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  processed_at    timestamptz
);

-- Dedupe on (org, source, source_event_id) when the source supplies one.
create unique index agent_events_source_dedupe_idx
  on public.agent_events (org_id, source, source_event_id)
  where source_event_id is not null;

-- Hot paths: the cron sweep picks the oldest pending row; the inbox UI
-- reads recent events per org.
create index agent_events_org_status_created_idx
  on public.agent_events (org_id, status, created_at desc);
create index agent_events_pending_created_idx
  on public.agent_events (created_at)
  where status = 'pending';

alter table public.agent_events enable row level security;

-- Org members can read; admin clients (service role) handle writes. We
-- deliberately don't expose write policies — events are produced by the
-- webhook handler and runners, both running as service role.
create policy agent_events_select on public.agent_events
  for select using (public.is_org_member(org_id));
