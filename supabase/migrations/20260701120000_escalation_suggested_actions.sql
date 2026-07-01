-- Structured next-actions George proposes when raising a decision. Each entry:
--   { "label": "Add Fraser Maclean as a platform user", "kind": "create" }
-- kind ∈ create | assign | update | email | confirm | other (advisory, for the
-- badge/icon). Rendered as one-click buttons on the AI actions page that push
-- the instruction into the contextual George chat.
alter table public.escalations
  add column if not exists suggested_actions jsonb not null default '[]'::jsonb;
