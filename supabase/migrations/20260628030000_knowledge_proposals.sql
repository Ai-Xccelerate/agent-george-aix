-- Knowledge proposals — George's staged knowledge writes awaiting human review.
--
-- The knowledge analog of "draft, never auto-send": George never writes to the
-- live knowledge base directly. He proposes a concept (new or an edit to an
-- existing one) here as `pending`; a reviewer (e.g. Nawaz / John) approves or
-- rejects. On approval the proposal is upserted into knowledge_docs (status
-- 'active'), chunked + embedded into retrieval, and logged. On rejection it's
-- kept with a note for the audit trail.
--
-- Staged separately from knowledge_docs so proposals can target an existing
-- path (a proposed edit) without colliding with knowledge_docs' unique(path),
-- and so the live KB is never polluted by unreviewed content.

create table if not exists public.knowledge_proposals (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  path          text not null,                       -- target concept path
  kind          text not null default 'create' check (kind in ('create','update')),
  concept_type  text,                                -- OKF `type`
  title         text,
  description   text,
  tags          text[] not null default '{}',
  links         text[] not null default '{}',
  content_md    text not null,                       -- body (no frontmatter)
  source        text not null default 'chat'         -- where the signal came from
                  check (source in ('chat','email','meeting','instruction','manual')),
  source_ref    text,                                -- session id / event id / note
  rationale     text,                                -- why George proposes this
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  proposed_by   uuid references auth.users(id),      -- null when proposed autonomously
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists knowledge_proposals_org_status_idx
  on public.knowledge_proposals (org_id, status, created_at desc);

drop trigger if exists trg_knowledge_proposals_updated_at on public.knowledge_proposals;
create trigger trg_knowledge_proposals_updated_at
  before update on public.knowledge_proposals
  for each row execute function public.set_updated_at();

alter table public.knowledge_proposals enable row level security;

drop policy if exists knowledge_proposals_member_read on public.knowledge_proposals;
create policy knowledge_proposals_member_read on public.knowledge_proposals
  for select using (public.is_org_member(org_id));

drop policy if exists knowledge_proposals_admin_write on public.knowledge_proposals;
create policy knowledge_proposals_admin_write on public.knowledge_proposals
  for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
