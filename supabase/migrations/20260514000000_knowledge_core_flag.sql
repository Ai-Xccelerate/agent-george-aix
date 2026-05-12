-- =====================================================================
-- Mark certain knowledge docs as "core" — high-accuracy organizational
-- knowledge that George loads in full at session start. Non-core docs
-- remain chunked + searched via RAG.
-- =====================================================================

alter table public.knowledge_docs
  add column if not exists is_core boolean not null default false;

create index if not exists knowledge_docs_org_is_core_idx
  on public.knowledge_docs (org_id, is_core);
