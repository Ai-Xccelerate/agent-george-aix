-- Escalations — George's "I need a human" queue.
--
-- When George (autonomously) hits a judgement call he can't make — a pricing or
-- commercial decision, an external email he shouldn't send unreviewed, anything
-- above his remit — he records a structured escalation here AND emails his
-- manager. The dashboard surfaces open rows as "Needs you" so an escalation
-- can't sit unseen in a chat summary for days (the old failure mode).
--
-- Created by the agent backend (service role, bypasses RLS). Humans in the org
-- read them and resolve them.

create table public.escalations (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  customer_id    uuid references public.customers(id) on delete set null,
  -- The chat/run session this arose in, so the reviewer can open the full
  -- context George wrote up.
  session_id     uuid references public.agent_sessions(id) on delete set null,
  title          text not null,
  detail         text,                         -- what's going on + what George needs decided
  recommendation text,                          -- George's proposed answer, if he has one
  urgency        text not null default 'normal',-- low | normal | high
  status         text not null default 'open',  -- open | resolved | dismissed
  resolved_by    uuid,                           -- org member who closed it
  resolution     text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index escalations_open_idx
  on public.escalations (org_id, created_at desc)
  where status = 'open';
create index escalations_customer_idx
  on public.escalations (customer_id)
  where customer_id is not null;

create trigger trg_escalations_updated_at
  before update on public.escalations
  for each row execute function public.set_updated_at();

alter table public.escalations enable row level security;

-- Org members read and resolve; inserts come from the service-role agent client.
create policy escalations_select on public.escalations
  for select using (public.is_org_member(org_id));
create policy escalations_update on public.escalations
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
