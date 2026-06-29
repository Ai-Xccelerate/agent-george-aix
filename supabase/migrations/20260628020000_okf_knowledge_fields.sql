-- OKF (Open Knowledge Format) fields on knowledge_docs.
--
-- OKF models knowledge as markdown "concepts" with YAML frontmatter: a required
-- `type`, plus recommended `description`, `tags`, `resource`, and cross-links to
-- other concepts. We already store concepts as markdown rows in knowledge_docs;
-- this adds the OKF metadata so retrieval can filter by type/tag and follow
-- links, and so the knowledge graph (Settings → Agent George) has edges.
--
-- `status` carries the propose→review→publish lifecycle (Phase 2): George writes
-- new concepts as `pending_review`; a human reviewer promotes them to `active`,
-- at which point they get chunked + embedded into retrieval. This is the
-- knowledge analog of the email "draft, never auto-send" guardrail.
--
-- The existing `source` column ('manual' | 'sync:*') is extended in practice to
-- include the signal origin ('chat' | 'email' | 'meeting' | 'instruction'); no
-- enum to widen since it's free text.

alter table public.knowledge_docs
  add column if not exists concept_type text,                       -- OKF `type`
  add column if not exists description  text,                       -- one-line summary
  add column if not exists tags         text[] not null default '{}',
  add column if not exists resource     text,                       -- URI for the underlying asset
  add column if not exists links        text[] not null default '{}', -- outgoing concept paths (graph edges)
  add column if not exists status       text not null default 'active'
    check (status in ('active','draft','pending_review','archived')),
  add column if not exists proposed_by  uuid references auth.users(id),
  add column if not exists reviewed_by  uuid references auth.users(id),
  add column if not exists reviewed_at  timestamptz;

create index if not exists knowledge_docs_org_type_idx
  on public.knowledge_docs (org_id, concept_type);

create index if not exists knowledge_docs_org_status_idx
  on public.knowledge_docs (org_id, status);

create index if not exists knowledge_docs_tags_gin
  on public.knowledge_docs using gin (tags);

-- Backfill: everything synced so far is a manually-authored, active concept.
-- Give core docs a sensible default type; the sync script overrides from
-- frontmatter on the next run.
update public.knowledge_docs
  set concept_type = coalesce(concept_type, case when is_core then 'playbook' else 'reference' end),
      status = coalesce(status, 'active')
  where concept_type is null;
