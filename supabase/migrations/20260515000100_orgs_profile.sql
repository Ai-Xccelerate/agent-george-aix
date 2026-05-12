-- Adds editable brand/profile fields to orgs so admins can manage their
-- company profile via /settings/organization (backlog item #14). Also creates
-- the `org-assets` storage bucket for logo uploads.

alter table public.orgs
  add column if not exists display_name        text,
  add column if not exists customer_brand_name text,
  add column if not exists tagline             text,
  add column if not exists brand_color         text,
  add column if not exists default_timezone    text,
  add column if not exists business_hours      jsonb,
  add column if not exists logo_square_path    text,
  add column if not exists logo_wordmark_path  text,
  add column if not exists updated_by          uuid references auth.users(id);

-- orgs already has an updated_at column but never had the trigger wired up.
drop trigger if exists trg_orgs_updated_at on public.orgs;
create trigger trg_orgs_updated_at
  before update on public.orgs
  for each row execute function public.set_updated_at();

-- Allow admins to update their own org row. (The base orgs table has no
-- existing UPDATE policy — service-role admin client writes still work.)
drop policy if exists orgs_admin_update on public.orgs;
create policy orgs_admin_update on public.orgs
  for update
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

-- Storage bucket for org-level brand assets (logos). Public read so we can
-- render <img src> straight from the public URL; writes are gated by the
-- policies below.
insert into storage.buckets (id, name, public)
  values ('org-assets', 'org-assets', true)
  on conflict (id) do update set public = excluded.public;

-- Files are stored under `<org_id>/<filename>`. Path-prefix matching gates
-- write access to admins of that org.
drop policy if exists "org-assets read" on storage.objects;
create policy "org-assets read" on storage.objects
  for select
  using (bucket_id = 'org-assets');

drop policy if exists "org-assets admin write" on storage.objects;
create policy "org-assets admin write" on storage.objects
  for insert
  with check (
    bucket_id = 'org-assets'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "org-assets admin update" on storage.objects;
create policy "org-assets admin update" on storage.objects
  for update
  using (
    bucket_id = 'org-assets'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'org-assets'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "org-assets admin delete" on storage.objects;
create policy "org-assets admin delete" on storage.objects
  for delete
  using (
    bucket_id = 'org-assets'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );
