-- Local mirror of George's M365 mailbox + calendar (agent.george@getonyx.ai).
--
-- Why a mirror at all: George reasons over his own inbox/sent/calendar as a
-- first-class data source (longitudinal history, sentiment, "what did we say
-- to this partner in March"), and the /inbox + calendar UI render from these
-- tables instead of a live API round-trip per page load.
--
-- Source of truth stays Microsoft via Composio's Outlook toolkit. These tables
-- are a cache kept fresh by: (1) one resumable initial backfill, (2) per-folder
-- delta sync (Graph deltaLink), (3) the existing OUTLOOK_MESSAGE_TRIGGER webhook
-- for near-real-time inbound. Composio proxies Graph transparently — verified
-- that @odata.nextLink (paging) and deltaLink/skiptoken (delta) survive — so no
-- direct Graph / Azure token stack is needed.
--
-- Single mailbox by design: the org-scoped Composio identity (org-<orgId>) is
-- one shared account, so this mirrors George's mailbox only, never per-human.

create type email_direction as enum (
  'inbound',   -- received (any folder that isn't Sent Items / Drafts)
  'outbound'   -- sent or drafted by George
);

-- ── Mail folders ────────────────────────────────────────────────────────────
-- The folder tree (Inbox, Sent Items, Drafts, and any custom folders). Holds
-- the per-folder sync cursors so backfill and delta can resume after a restart.
create table public.mail_folders (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  external_id          text not null,                 -- Graph mailFolder id
  parent_external_id   text,                           -- null for top-level
  display_name         text not null,
  well_known_name      text,                           -- inbox | sentitems | drafts | ...
  total_item_count     integer,
  unread_item_count    integer,
  -- Resumable initial backfill: the @odata.nextLink page cursor to pick up
  -- from; cleared and marked complete once the folder is fully paged.
  backfill_cursor      text,
  backfill_complete    boolean not null default false,
  -- Incremental sync: Graph deltaLink to fetch only changes since last run.
  delta_link           text,
  synced_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, external_id)
);

create index mail_folders_org_idx on public.mail_folders (org_id);

-- ── Email messages ──────────────────────────────────────────────────────────
create table public.email_messages (
  id                   uuid primary key default uuid_generate_v4(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  external_id          text not null,                 -- Graph message id (stable per mailbox)
  internet_message_id  text,                           -- RFC id, stable across folders/moves
  folder_external_id   text,                           -- logical ref to mail_folders.external_id
  conversation_id      text,                           -- threading key
  direction            email_direction not null,
  subject              text,
  body_preview         text,
  body_html            text,
  body_content_type    text,
  from_address         text,
  from_name            text,
  to_recipients        jsonb not null default '[]'::jsonb,
  cc_recipients        jsonb not null default '[]'::jsonb,
  bcc_recipients       jsonb not null default '[]'::jsonb,
  is_read              boolean not null default false,
  is_draft             boolean not null default false,
  has_attachments      boolean not null default false,
  importance           text,
  web_link             text,
  received_at          timestamptz,
  sent_at              timestamptz,
  -- Resolved against contacts/customers when known; null otherwise.
  customer_id          uuid references public.customers(id) on delete set null,
  -- Full Graph payload, so new fields don't require a backfill to recover.
  raw                  jsonb,
  synced_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, external_id)
);

create index email_messages_recent_idx
  on public.email_messages (org_id, received_at desc);
create index email_messages_conversation_idx
  on public.email_messages (org_id, conversation_id);
create index email_messages_folder_idx
  on public.email_messages (org_id, folder_external_id);
create index email_messages_customer_idx
  on public.email_messages (customer_id)
  where customer_id is not null;

-- ── Attachments ─────────────────────────────────────────────────────────────
-- Metadata is mirrored eagerly; the bytes are pulled into Supabase Storage
-- lazily (storage_path stays null until downloaded).
create table public.email_attachments (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  message_id    uuid not null references public.email_messages(id) on delete cascade,
  external_id   text not null,                          -- Graph attachment id
  name          text,
  content_type  text,
  size_bytes    bigint,
  is_inline     boolean not null default false,
  storage_path  text,
  synced_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (message_id, external_id)
);

create index email_attachments_org_idx on public.email_attachments (org_id);

-- ── Calendars ───────────────────────────────────────────────────────────────
create table public.calendars (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  external_id       text not null,
  name              text,
  is_default        boolean not null default false,
  can_edit          boolean not null default false,
  backfill_cursor   text,
  backfill_complete boolean not null default false,
  delta_link        text,
  synced_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, external_id)
);

create index calendars_org_idx on public.calendars (org_id);

-- ── Calendar events ─────────────────────────────────────────────────────────
-- Recurrence is stored as Graph returns it (master + the recurrence rule);
-- expansion to concrete occurrences happens on read against a time window.
create table public.calendar_events (
  id                        uuid primary key default uuid_generate_v4(),
  org_id                    uuid not null references public.orgs(id) on delete cascade,
  external_id               text not null,            -- Graph event id
  calendar_external_id      text,
  ical_uid                  text,
  subject                   text,
  body_preview              text,
  body_html                 text,
  location                  text,
  is_all_day                boolean not null default false,
  is_cancelled              boolean not null default false,
  start_at                  timestamptz,
  end_at                    timestamptz,
  start_timezone            text,                     -- original tz Graph reported
  end_timezone              text,
  organizer_address         text,
  organizer_name            text,
  attendees                 jsonb not null default '[]'::jsonb,
  recurrence                jsonb,                    -- pattern/range, null for single events
  series_master_external_id text,                     -- set on occurrences/exceptions
  event_type                text,                     -- singleInstance | occurrence | exception | seriesMaster
  online_meeting_url        text,
  web_link                  text,
  response_status           text,
  customer_id               uuid references public.customers(id) on delete set null,
  raw                       jsonb,
  synced_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (org_id, external_id)
);

create index calendar_events_window_idx
  on public.calendar_events (org_id, start_at);
create index calendar_events_calendar_idx
  on public.calendar_events (org_id, calendar_external_id);
create index calendar_events_customer_idx
  on public.calendar_events (customer_id)
  where customer_id is not null;

-- ── updated_at triggers ───────────────────────────────────────────────────
create trigger trg_mail_folders_updated_at
  before update on public.mail_folders
  for each row execute function public.set_updated_at();
create trigger trg_email_messages_updated_at
  before update on public.email_messages
  for each row execute function public.set_updated_at();
create trigger trg_calendars_updated_at
  before update on public.calendars
  for each row execute function public.set_updated_at();
create trigger trg_calendar_events_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Humans in the org read; the agent backend writes via the service-role client
-- (which bypasses RLS), same pattern as every other agent-owned table.
alter table public.mail_folders      enable row level security;
alter table public.email_messages    enable row level security;
alter table public.email_attachments enable row level security;
alter table public.calendars         enable row level security;
alter table public.calendar_events   enable row level security;

create policy mail_folders_select on public.mail_folders
  for select using (public.is_org_member(org_id));
create policy email_messages_select on public.email_messages
  for select using (public.is_org_member(org_id));
create policy email_attachments_select on public.email_attachments
  for select using (public.is_org_member(org_id));
create policy calendars_select on public.calendars
  for select using (public.is_org_member(org_id));
create policy calendar_events_select on public.calendar_events
  for select using (public.is_org_member(org_id));
