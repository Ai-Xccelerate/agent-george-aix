-- ---------------------------------------------------------------------
-- documents
--
-- One row per file uploaded into Agent George (HLR §10). Today: in-chat
-- attachments uploaded via the paperclip button (backlog #19). Tomorrow:
-- contract / NDA / order-form parsing fills `kind` + `extracted_fields`
-- (backlog #18), and Composio inbound-mail attachments land here too.
--
-- - `storage_path` is the key inside the `customer-docs` Supabase Storage
--   bucket. Path convention: `<org_id>/<doc-uuid>-<original-name>`. The
--   leading folder is what the bucket's RLS policy gates on.
-- - `customer_id` is nullable — sometimes a file arrives before George
--   has identified the customer (e.g. an unprompted contract in chat).
-- - `session_id` is nullable — files can be uploaded outside a chat
--   session (e.g. inbound email attachments).
-- - `extracted_fields` is reserved for the parsing pass in #18.
-- ---------------------------------------------------------------------

create table public.documents (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  customer_id      uuid references public.customers(id) on delete set null,
  session_id       uuid references public.agent_sessions(id) on delete set null,
  uploaded_by      uuid references auth.users(id) on delete set null,
  storage_path     text not null,
  original_name    text not null,
  mime_type        text not null,
  file_size        int not null,
  kind             text,                                       -- 'contract' | 'nda' | 'order_form' | null
  extracted_fields jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (org_id, storage_path)
);

create index on public.documents (org_id, created_at desc);
create index on public.documents (customer_id, created_at desc);
create index on public.documents (session_id);

alter table public.documents enable row level security;

create policy documents_select on public.documents
  for select using (public.is_org_member(org_id));

create policy documents_insert on public.documents
  for insert with check (public.is_org_member(org_id));

create policy documents_update on public.documents
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy documents_delete on public.documents
  for delete using (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------
-- Storage bucket — private, org-prefixed paths. Same shape as `org-assets`
-- (migration 20260515000100) but read is org-member rather than public.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('customer-docs', 'customer-docs', false)
  on conflict (id) do nothing;

drop policy if exists "customer-docs read" on storage.objects;
create policy "customer-docs read" on storage.objects
  for select
  using (
    bucket_id = 'customer-docs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "customer-docs write" on storage.objects;
create policy "customer-docs write" on storage.objects
  for insert
  with check (
    bucket_id = 'customer-docs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "customer-docs update" on storage.objects;
create policy "customer-docs update" on storage.objects
  for update
  using (
    bucket_id = 'customer-docs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'customer-docs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "customer-docs delete" on storage.objects;
create policy "customer-docs delete" on storage.objects
  for delete
  using (
    bucket_id = 'customer-docs'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );
