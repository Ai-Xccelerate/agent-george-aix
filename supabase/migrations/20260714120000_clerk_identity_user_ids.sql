-- Clerk identity, part 2 — retype ALL user-id columns from uuid to text.
--
-- The first clerk_identity migration (20260713100000) retyped only
-- org_members.user_id. Every OTHER user-id column was left as `uuid references
-- auth.users(id)`. Under Clerk those columns must hold a Clerk user id (text,
-- e.g. "user_2ab..."), so any INSERT that writes one fails — most visibly the
-- floating chat bubble's agent_sessions insert, which hangs the UI on
-- "Starting conversation…". Same failure lurks for customers.owner_user_id,
-- documents.uploaded_by, invites.invited_by, objectives, cadences, agent_jobs,
-- knowledge proposals, domain_allowlist, agent_settings, etc.
--
-- Drop every foreign key from public.* to auth.users and retype the referencing
-- column to text. Done dynamically (by FK target, not name) so we needn't
-- enumerate each auto-generated constraint name. Idempotent: re-running finds
-- no remaining auth.users FKs and does nothing.

do $$
declare
  r record;
begin
  for r in
    select cl.relname as tbl, att.attname as col, con.conname as cname
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_class rf on rf.oid = con.confrelid
    join pg_namespace rn on rn.oid = rf.relnamespace
    cross join lateral unnest(con.conkey) as k(attnum)
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and n.nspname = 'public'
      and rn.nspname = 'auth'
      and rf.relname = 'users'
  loop
    execute format('alter table public.%I drop constraint %I', r.tbl, r.cname);
    execute format(
      'alter table public.%I alter column %I type text using %I::text',
      r.tbl, r.col, r.col
    );
  end loop;
end $$;

-- escalations.resolved_by was declared as a bare uuid (no FK) — retype too.
alter table public.escalations
  alter column resolved_by type text using resolved_by::text;
