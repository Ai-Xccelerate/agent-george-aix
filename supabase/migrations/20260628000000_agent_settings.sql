-- Agent identity / configuration. Gives George a real "employee" record per org
-- that an admin edits from /settings/agent: name, title, bio, avatar, tone
-- preset, default operating mode, and a human owner (escalation contact).
--
-- This is an ADDITIVE overlay on the in-code system prompt — it customises
-- identity + tone, it does NOT replace the locked operating rules (draft-never-
-- send, no SKU invention, tool allowlist). Those stay hardcoded.
--
-- `agent_slug` is here so the eventual Nick → Jules → … → George lineup is cheap
-- later; today there is exactly one row per org with slug 'george'.

create table if not exists public.agent_settings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  agent_slug      text not null default 'george',
  name            text not null default 'George',
  title           text not null default 'AI Customer Success Teammate',
  bio             text,
  personality     text not null default 'concise_direct'
                    check (personality in ('concise_direct','warm_consultative','formal')),
  operating_mode  text not null default 'assistant'
                    check (operating_mode in ('assistant','operator')),
  owner_user_id   uuid references auth.users(id) on delete set null,
  avatar_path     text,
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, agent_slug)
);

create index if not exists agent_settings_org_idx on public.agent_settings (org_id);

drop trigger if exists trg_agent_settings_updated_at on public.agent_settings;
create trigger trg_agent_settings_updated_at
  before update on public.agent_settings
  for each row execute function public.set_updated_at();

alter table public.agent_settings enable row level security;

-- Any org member can read their agent's identity (the chat UI shows it).
drop policy if exists agent_settings_member_read on public.agent_settings;
create policy agent_settings_member_read on public.agent_settings
  for select
  using (public.is_org_member(org_id));

-- Only admins may create/update. (Service-role admin client bypasses RLS for
-- the prompt builder + page reads.)
drop policy if exists agent_settings_admin_write on public.agent_settings;
create policy agent_settings_admin_write on public.agent_settings
  for all
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

-- Seed one George row for every existing org so the page always has a record.
insert into public.agent_settings (org_id)
  select id from public.orgs
  on conflict (org_id, agent_slug) do nothing;
