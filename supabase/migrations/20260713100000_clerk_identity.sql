-- AIX Core integration: re-key tenant rows to Clerk identifiers.
--
-- Under Clerk auth, org_members.user_id holds the Clerk user id (text, e.g.
-- "user_..."), not a Supabase auth.users UUID. orgs gains clerk_org_id so the
-- JIT-mirror can find/create the local org that mirrors a Clerk organization.
--
-- Security is enforced at the Clerk session + Core /access layer (see
-- src/lib/aix-core/*), and the agent backend already scopes every query by
-- org_id on the service-role client. RLS keyed on auth.uid() no longer applies
-- once Supabase Auth is retired; a follow-up either wires Supabase third-party
-- auth (Clerk) or removes the now-inert RLS helpers.

alter table public.orgs
  add column if not exists clerk_org_id text unique;

-- Drop the Supabase-auth RLS policies on org_members. They key on auth.uid()
-- (a UUID), which no longer applies under Clerk, and they block the column
-- retype below. The app now reads org_members via the service-role admin
-- client, so RLS on this table is inert.
drop policy if exists org_members_select on public.org_members;
drop policy if exists org_members_self_upsert on public.org_members;
drop policy if exists org_members_self_update on public.org_members;

-- Drop the FK to auth.users and retype user_id to text (Clerk ids aren't UUIDs).
alter table public.org_members
  drop constraint if exists org_members_user_id_fkey;

alter table public.org_members
  alter column user_id type text using user_id::text;
