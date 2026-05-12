-- =====================================================================
-- RLS — every tenant table gates by org membership.
-- Service role (used by the agent backend) bypasses RLS automatically.
-- =====================================================================

-- Membership helper: which org_ids does the current authed user belong to?
create or replace function public.user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

grant execute on function public.user_org_ids() to authenticated;

-- Generic "row belongs to one of my orgs" helper for tables with org_id
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid() and org_id = target_org
  );
$$;

grant execute on function public.is_org_member(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Enable RLS + policies
-- ---------------------------------------------------------------------
alter table public.orgs              enable row level security;
alter table public.org_members       enable row level security;
alter table public.customers         enable row level security;
alter table public.contacts          enable row level security;
alter table public.contracts         enable row level security;
alter table public.onboarding_plans  enable row level security;
alter table public.onboarding_steps  enable row level security;
alter table public.customer_health   enable row level security;
alter table public.agent_sessions    enable row level security;
alter table public.agent_messages    enable row level security;
alter table public.memories          enable row level security;
alter table public.knowledge_docs    enable row level security;
alter table public.knowledge_chunks  enable row level security;
alter table public.integrations      enable row level security;
alter table public.audit_log         enable row level security;

-- orgs: members can see their orgs.
create policy orgs_select on public.orgs
  for select using (public.is_org_member(id));

-- org_members: members can see fellow members of orgs they belong to.
create policy org_members_select on public.org_members
  for select using (public.is_org_member(org_id));

create policy org_members_self_upsert on public.org_members
  for insert with check (user_id = auth.uid());

-- Tables that have org_id directly: read + write gated by membership.
do $$
declare t text;
begin
  for t in select unnest(array[
    'customers','agent_sessions','memories',
    'knowledge_docs','knowledge_chunks',
    'integrations','audit_log'
  ])
  loop
    execute format('create policy %I_select on public.%I for select using (public.is_org_member(org_id));', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (public.is_org_member(org_id));', t, t);
    execute format('create policy %I_update on public.%I for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));', t, t);
    execute format('create policy %I_delete on public.%I for delete using (public.is_org_member(org_id));', t, t);
  end loop;
end $$;

-- Tables that join through customer: gate by the customer's org.
create policy contacts_rw on public.contacts
  for all using (
    exists (select 1 from public.customers c
            where c.id = contacts.customer_id and public.is_org_member(c.org_id))
  ) with check (
    exists (select 1 from public.customers c
            where c.id = contacts.customer_id and public.is_org_member(c.org_id))
  );

create policy contracts_rw on public.contracts
  for all using (
    exists (select 1 from public.customers c
            where c.id = contracts.customer_id and public.is_org_member(c.org_id))
  ) with check (
    exists (select 1 from public.customers c
            where c.id = contracts.customer_id and public.is_org_member(c.org_id))
  );

create policy onboarding_plans_rw on public.onboarding_plans
  for all using (
    exists (select 1 from public.customers c
            where c.id = onboarding_plans.customer_id and public.is_org_member(c.org_id))
  ) with check (
    exists (select 1 from public.customers c
            where c.id = onboarding_plans.customer_id and public.is_org_member(c.org_id))
  );

create policy onboarding_steps_rw on public.onboarding_steps
  for all using (
    exists (select 1 from public.customers c
            where c.id = onboarding_steps.customer_id and public.is_org_member(c.org_id))
  ) with check (
    exists (select 1 from public.customers c
            where c.id = onboarding_steps.customer_id and public.is_org_member(c.org_id))
  );

create policy customer_health_rw on public.customer_health
  for all using (
    exists (select 1 from public.customers c
            where c.id = customer_health.customer_id and public.is_org_member(c.org_id))
  ) with check (
    exists (select 1 from public.customers c
            where c.id = customer_health.customer_id and public.is_org_member(c.org_id))
  );

-- agent_messages: gate via the parent session's org.
create policy agent_messages_rw on public.agent_messages
  for all using (
    exists (select 1 from public.agent_sessions s
            where s.id = agent_messages.session_id and public.is_org_member(s.org_id))
  ) with check (
    exists (select 1 from public.agent_sessions s
            where s.id = agent_messages.session_id and public.is_org_member(s.org_id))
  );
