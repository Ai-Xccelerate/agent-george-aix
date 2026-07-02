-- Domain allowlist — org-controlled expansion of George's email trust boundary.
--
-- send_email_draft (composio-tools.ts) hard-refuses any recipient outside
-- @getonyx.ai. This table is the one sanctioned way to widen that: George (or
-- a human) proposes a domain here as 'pending'; only an owner/admin/CSM can
-- approve or reject it. Only 'approved' rows ever let send_email_draft treat
-- an external recipient as sendable — mirrors the "propose, human decides"
-- pattern already used for knowledge_proposals.

create table public.domain_allowlist (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  domain        text not null,                       -- lowercase, no scheme, e.g. 'acmecorp.com'
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason        text,                                 -- why George/the requester needs this domain
  customer_id   uuid references public.customers(id) on delete set null,
  requested_by  uuid references auth.users(id) on delete set null, -- null when George proposed it
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index domain_allowlist_org_domain_idx
  on public.domain_allowlist (org_id, lower(domain));

create index domain_allowlist_org_status_idx
  on public.domain_allowlist (org_id, status);

drop trigger if exists trg_domain_allowlist_updated_at on public.domain_allowlist;
create trigger trg_domain_allowlist_updated_at
  before update on public.domain_allowlist
  for each row execute function public.set_updated_at();

alter table public.domain_allowlist enable row level security;

create policy domain_allowlist_select on public.domain_allowlist
  for select using (public.is_org_member(org_id));

-- Any org member can propose a domain...
create policy domain_allowlist_member_insert on public.domain_allowlist
  for insert with check (public.is_org_member(org_id));

-- ...but approving/rejecting/removing one is restricted to owner/admin/CSM.
create or replace function public.can_approve_domains(target_org uuid)
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
      and role in ('owner', 'admin', 'csm')
  );
$$;

grant execute on function public.can_approve_domains(uuid) to authenticated;

create policy domain_allowlist_approver_update on public.domain_allowlist
  for update using (public.can_approve_domains(org_id))
  with check (public.can_approve_domains(org_id));

create policy domain_allowlist_approver_delete on public.domain_allowlist
  for delete using (public.can_approve_domains(org_id));
