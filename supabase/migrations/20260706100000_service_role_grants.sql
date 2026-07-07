-- Local Supabase omits default PostgREST grants on app tables. Without these,
-- admitUser() fails with "permission denied for table org_members" for both
-- authenticated and service_role clients.
grant usage on schema public to authenticated, service_role;

grant select, insert, update on table public.org_members to authenticated;
grant all on table public.org_members to service_role;

grant select on table public.orgs to authenticated;
grant all on table public.orgs to service_role;

-- SECURITY DEFINER fallback: self-admit on sign-in when GRANTs are still missing.
create or replace function public.admit_org_member(
  p_org_id uuid,
  p_user_id uuid,
  p_role text,
  p_full_name text,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return false;
  end if;

  insert into public.org_members (org_id, user_id, role, full_name, email)
  values (p_org_id, p_user_id, p_role, p_full_name, p_email)
  on conflict (org_id, user_id) do nothing;

  return true;
end;
$$;

grant execute on function public.admit_org_member(uuid, uuid, text, text, text) to authenticated, service_role;
