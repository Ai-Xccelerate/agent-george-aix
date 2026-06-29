-- Configurable knowledge reviewers (e.g. Nawaz, John). Stored as an email list
-- on agent_settings so the weekly review can address them now, before they're
-- invited as org members. Once invited via Settings → Users, the same emails
-- resolve to real accounts — no migration needed.
alter table public.agent_settings
  add column if not exists knowledge_reviewers text[] not null default '{}';
