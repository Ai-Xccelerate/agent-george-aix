-- ---------------------------------------------------------------------
-- match_knowledge_chunks(p_org_id, p_query, p_limit)
--
-- Vector-similarity search for the `search_knowledge` MCP tool (BACKLOG
-- #5). Cosine distance (`<=>`) against `knowledge_chunks.embedding`,
-- scoped to one org. Returns the top-N chunks joined with their parent
-- doc's path / title / is_core flag.
--
-- Why a SECURITY DEFINER function:
--   - The agent backend calls this via the service-role admin client,
--     which already bypasses RLS — security definer is belt-and-braces
--     to keep behaviour identical if the function is ever called from
--     an anon/auth context.
--   - Keeps the cosine-distance SQL on the database side; the
--     PostgREST query builder doesn't have a native `<=>` operator.
--
-- `similarity` returned = 1 - cosine_distance. 1.0 = perfect match,
-- ~0.0 = unrelated. Useful for filtering thin matches client-side.
--
-- The `embedding IS NOT NULL` filter keeps any half-backfilled state
-- from returning the literal-zero distance pgvector emits for NULLs.
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
  order by c.embedding <=> p_query
  limit greatest(p_limit, 1)
$$;

revoke all on function public.match_knowledge_chunks(uuid, vector, int) from public;
grant execute on function public.match_knowledge_chunks(uuid, vector, int) to service_role;
grant execute on function public.match_knowledge_chunks(uuid, vector, int) to authenticated;
