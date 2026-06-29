-- Local mirror of George's Scribe meeting transcripts.
--
-- Why a mirror: George reasons over meeting transcripts as a first-class data
-- source (decisions, action items, who-said-what) the same way he already
-- reasons over his mailbox + calendar mirror. The /transcripts UI renders from
-- this table, and George reads it via the list_transcripts / read_transcript
-- tools — no live Scribe round-trip per page load or per agent turn.
--
-- Source of truth stays Scribe (app.getscribe.xyz). This table is a cache kept
-- fresh by syncTranscripts() (src/lib/agent/transcript-sync.ts), called on the
-- same once-a-minute cron tick that syncs the mailbox. Scribe auto-joins
-- meetings George is invited to; the sync pulls each finished meeting's
-- transcript + insights once and upserts idempotently on (org_id, external_id).
--
-- Single-account by design: one Scribe workspace token for agent.george, so
-- this mirrors George's meetings only (the org-scoped note-taker), never
-- per-human.

create table public.meeting_transcripts (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  external_id          text not null,                 -- Scribe meeting id (uuid)
  title                text,
  status               text,                          -- Scribe status: completed | processing | ...
  started_at           timestamptz,
  ended_at             timestamptz,
  duration_min         integer,
  attendees            jsonb not null default '[]'::jsonb,
  -- Flattened transcript text (speaker-labelled), for display + George reading.
  transcript_text      text,
  segment_count        integer,
  -- Scribe's structured AI summary (decisions, action items, topics, etc.).
  insights             jsonb,
  summary              text,                           -- short overview pulled from insights when present
  -- Resolved links when known; null otherwise.
  customer_id          uuid references public.customers(id) on delete set null,
  calendar_event_id    uuid references public.calendar_events(id) on delete set null,
  meeting_url          text,
  -- Full Scribe payloads, so new fields don't require a re-sync to recover.
  raw                  jsonb,
  synced_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, external_id)
);

create index meeting_transcripts_recent_idx
  on public.meeting_transcripts (org_id, ended_at desc);
create index meeting_transcripts_customer_idx
  on public.meeting_transcripts (customer_id)
  where customer_id is not null;

create trigger trg_meeting_transcripts_updated_at
  before update on public.meeting_transcripts
  for each row execute function public.set_updated_at();

-- RLS: humans in the org read; the agent backend writes via the service-role
-- client (which bypasses RLS) — same pattern as the mailbox/calendar mirror.
alter table public.meeting_transcripts enable row level security;

create policy meeting_transcripts_select on public.meeting_transcripts
  for select using (public.is_org_member(org_id));

-- New orgs default to US Pacific (editable in Settings → Agent George →
-- identity, which writes orgs.default_timezone — the same column cron
-- scheduling reads). Deliberately NOT backfilling existing nulls: cron falls
-- back to UTC for unset orgs, so a blanket update would silently retime any
-- standing job / cadence that hasn't pinned its own timezone. The calendar +
-- identity form already fall back to Pacific for display; the explicit Save on
-- the identity form is what moves cron to Pacific, intentionally.
alter table public.orgs alter column default_timezone set default 'America/Los_Angeles';
