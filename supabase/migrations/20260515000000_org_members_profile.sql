-- Adds editable profile fields to org_members so members can manage their own
-- name, timezone, and locale via /settings/profile (backlog item #15).

alter table public.org_members
  add column if not exists timezone   text,
  add column if not exists locale     text,
  add column if not exists updated_at timestamptz not null default now();

create trigger trg_org_members_updated_at
  before update on public.org_members
  for each row execute function public.set_updated_at();

-- Allow a member to update their own row (name, timezone, locale).
-- Role/email/org_id changes still flow through admin server actions which use
-- the service-role client and bypass RLS.
create policy org_members_self_update on public.org_members
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
