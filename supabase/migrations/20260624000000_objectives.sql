-- Objectives — the things George chases to keep an onboarding moving.
--
-- Each objective carries its own "clock": George follows up on a default
-- cadence until the objective is ACHIEVED (his judgment from reading the
-- thread), not merely replied to. An out-of-office does not stop the clock;
-- getting the actual deliverable does.
--
-- Objectives are two-sided: some are customer-owed (George chases the contact),
-- some are onyx-owed (George nudges the internal role-owner). A hard external
-- deadline (`due_date`) compresses the follow-up cadence. Escalation/reporting
-- routes to the customer's relationship owner (customers.owner_user_id).
--
-- Design: docs/03-objectives-owners-and-the-clock.md.

create type objective_kind as enum (
  'standard',      -- from the generic onboarding standard set (logo, admin user, price list, whitelisting, ...)
  'from_meeting',  -- derived from a kickoff / check-in transcript
  'ad_hoc'
);

create type objective_status as enum (
  'pending',       -- created, not yet actively chased
  'awaiting',      -- George is waiting on it; the clock is running
  'achieved',      -- objective met (George's judgment) — clock stopped
  'blocked',       -- escalated / stuck, pending a human
  'cancelled'
);

create type objective_side as enum (
  'customer',      -- the customer owes this; George chases the responsible contact
  'onyx'           -- Onyx owes this; George nudges the internal role-owner
);

create table public.objectives (
  id                      uuid primary key default uuid_generate_v4(),
  org_id                  uuid not null references public.orgs(id) on delete cascade,
  customer_id             uuid not null references public.customers(id) on delete cascade,
  title                   text not null,
  description             text,
  kind                    objective_kind not null default 'ad_hoc',
  status                  objective_status not null default 'pending',
  -- Who owes it. Drives whether George chases the contact or nudges internally.
  responsible_side        objective_side not null default 'customer',
  -- Customer-side person George chases (when responsible_side = 'customer').
  responsible_contact_id  uuid references public.contacts(id) on delete set null,
  -- Internal role-owner George nudges (when responsible_side = 'onyx'); distinct
  -- from the customer's relationship owner on customers.owner_user_id.
  owner_side_user_id      uuid references auth.users(id) on delete set null,
  -- Key people both sides to CC on outreach about this objective.
  cc_emails               jsonb not null default '[]'::jsonb,
  -- Hard external deadline; when set, escalation urgency = min(default cadence,
  -- deadline-derived) so George moves faster than the 48h default.
  due_date                date,
  followup_interval_hours integer not null default 48,
  next_followup_at        timestamptz,        -- the clock; null until 'awaiting'
  followup_count          integer not null default 0,
  max_followups           integer not null default 2,  -- nudges before escalation
  -- Outlook conversation George watches to judge achievement.
  thread_conversation_id  text,
  source_session_id       uuid references public.agent_sessions(id) on delete set null,
  achieved_at             timestamptz,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index objectives_customer_idx
  on public.objectives (customer_id, status);

-- The scheduler scan: due objectives still being awaited.
create index objectives_due_idx
  on public.objectives (next_followup_at)
  where status = 'awaiting';

create index objectives_org_idx
  on public.objectives (org_id, status);

create trigger trg_objectives_updated_at
  before update on public.objectives
  for each row execute function public.set_updated_at();

alter table public.objectives enable row level security;

create policy objectives_select on public.objectives
  for select using (public.is_org_member(org_id));
create policy objectives_insert on public.objectives
  for insert with check (public.is_org_member(org_id));
create policy objectives_update on public.objectives
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy objectives_delete on public.objectives
  for delete using (public.is_org_member(org_id));
