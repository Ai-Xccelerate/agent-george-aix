-- Human-facing mailbox signals on the email mirror.
--
--   flagged / flag_note  — a teammate flags an email as a signal to George
--                          (e.g. "handle this", "watch this account").
--   processed_at / processed_session_id — stamped when George's autonomous run
--                          actually handled the email, so the UI can show a
--                          "George reviewed" badge linking to his write-up.
alter table public.email_messages
  add column if not exists flagged boolean not null default false,
  add column if not exists flag_note text,
  add column if not exists processed_at timestamptz,
  add column if not exists processed_session_id uuid
    references public.agent_sessions(id) on delete set null;

create index if not exists email_messages_flagged_idx
  on public.email_messages (org_id)
  where flagged;
