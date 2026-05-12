-- =====================================================================
-- Invites: pending invitations to join an org.
-- Self-signup is disabled at the application layer; the only way in is via
-- an admin/owner invite OR an existing org_members row.
-- =====================================================================

create type invite_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.invites (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  email         text not null,
  full_name     text,
  role          text not null default 'csm' check (role in ('owner','admin','csm','sales','viewer')),
  invited_by    uuid references auth.users(id) on delete set null,
  status        invite_status not null default 'pending',
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  expires_at    timestamptz not null default (now() + interval '14 days')
);

create index on public.invites (org_id, status);

-- Only one *pending* invite per email per org. Older invites can stay (history).
create unique index invites_unique_pending
  on public.invites (org_id, lower(email))
  where status = 'pending';

alter table public.invites enable row level security;

-- Members of the org can see invites for their org.
create policy invites_select on public.invites
  for select using (public.is_org_member(org_id));

-- Only admins/owners can create / update / revoke invites.
create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and org_id = target_org
      and role in ('owner', 'admin')
  );
$$;

grant execute on function public.is_org_admin(uuid) to authenticated;

create policy invites_admin_insert on public.invites
  for insert with check (public.is_org_admin(org_id));

create policy invites_admin_update on public.invites
  for update using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

create policy invites_admin_delete on public.invites
  for delete using (public.is_org_admin(org_id));
