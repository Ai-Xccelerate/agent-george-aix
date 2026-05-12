-- ---------------------------------------------------------------------
-- match_knowledge_chunks — Option A policy: exclude core docs.
--
-- Core docs (`knowledge_docs.is_core = true`) carry George's role,
-- scope, lifecycle, and process rules. We don't want vector search
-- ever returning a lossy ~800-char chunk of those — the agent must
-- fetch the full doc verbatim via `read_knowledge_doc(path)`. The
-- manifest in the system prompt lists every core doc by path so
-- George knows what's there.
--
-- Practical effect:
--   - Vector search returns supplemental chunks only.
--   - Core knowledge is reached exclusively through
--     `read_knowledge_doc(path)`, which returns `content_md` whole.
--
-- See BACKLOG #5 status entry for the full hybrid-RAG policy.
-- ---------------------------------------------------------------------

create or replace function public.match_knowledge_chunks(
  p_org_id   uuid,
  p_query    vector(1536),
  p_limit    int default 5
)
returns table (
  chunk_id    uuid,
  doc_id      uuid,
  ordinal     int,
  content     text,
  similarity  float4,
  path        text,
  title       text,
  is_core     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id            as chunk_id,
    c.doc_id        as doc_id,
    c.ordinal       as ordinal,
    c.content       as content,
    (1 - (c.embedding <=> p_query))::float4 as similarity,
    d.path          as path,
    d.title         as title,
    d.is_core       as is_core
  from public.knowledge_chunks c
  join public.knowledge_docs   d on d.id = c.doc_id
  where c.org_id = p_org_id
    and c.embedding is not null
    and d.is_core = false
  order by c.embedding <=> p_query
  limit greatest(p_limit, 1)
$$;
