-- =====================================================================
-- Agent George — initial schema
-- One Supabase project, single org for now (Onyx) but org_id everywhere
-- so we can multi-tenant later without a rewrite.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";       -- pgvector for knowledge embeddings
create extension if not exists "pg_trgm";      -- fuzzy text search

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tenancy: orgs & users
-- ---------------------------------------------------------------------
create table public.orgs (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  domain      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.org_members (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','admin','csm','sales','viewer')),
  full_name   text,
  email       text,
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index on public.org_members (user_id);

-- ---------------------------------------------------------------------
-- Customers, contacts, contracts
-- ---------------------------------------------------------------------
create type customer_lifecycle as enum (
  'prospect',        -- in sales, not yet ours
  'onboarding',      -- contract signed, plan in flight
  'active',          -- onboarding complete, healthy or otherwise
  'at_risk',         -- explicit risk flag
  'churned'
);

create table public.customers (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  name            text not null,
  domain          text,
  lifecycle       customer_lifecycle not null default 'prospect',
  industry        text,
  size            text,                              -- '1-10', '11-50', etc.
  notes           text,
  owner_user_id   uuid references auth.users(id),    -- internal CSM owner
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.customers (org_id);
create index on public.customers (lifecycle);

create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create table public.contacts (
  id            uuid primary key default uuid_generate_v4(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  full_name     text not null,
  title         text,
  email         text,
  phone         text,
  is_primary    boolean not null default false,
  timezone      text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.contacts (customer_id);
create unique index contacts_one_primary_per_customer
  on public.contacts (customer_id) where is_primary;

create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

create type contract_status as enum ('draft','signed','active','expired','terminated');

create table public.contracts (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  status          contract_status not null default 'signed',
  start_date      date,
  end_date        date,
  arr_cents       bigint,                          -- annual revenue in cents
  currency        text default 'USD',
  signed_at       timestamptz,
  storage_path    text,                            -- supabase storage object
  summary         text,                            -- George's parsed summary
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.contracts (customer_id);

create trigger trg_contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Onboarding plan + steps
-- ---------------------------------------------------------------------
create type onboarding_status as enum ('planned','in_progress','blocked','completed','cancelled');

create table public.onboarding_plans (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  status          onboarding_status not null default 'planned',
  start_date      date,
  target_end_date date,
  actual_end_date date,
  pace            text,                            -- 'fast' | 'standard' | 'slow' | freeform
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index onboarding_one_active_per_customer
  on public.onboarding_plans (customer_id)
  where status in ('planned','in_progress','blocked');

create trigger trg_onboarding_plans_updated_at
  before update on public.onboarding_plans
  for each row execute function public.set_updated_at();

create table public.onboarding_steps (
  id              uuid primary key default uuid_generate_v4(),
  plan_id         uuid not null references public.onboarding_plans(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  ordinal         int  not null,                   -- 1-based step order
  title           text not null,
  description     text,
  status          onboarding_status not null default 'planned',
  due_date        date,
  completed_at    timestamptz,
  owner           text,                            -- 'george' | 'customer' | 'csm' | freeform
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (plan_id, ordinal)
);

create index on public.onboarding_steps (customer_id);
create index on public.onboarding_steps (plan_id, status);

create trigger trg_onboarding_steps_updated_at
  before update on public.onboarding_steps
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Customer health
-- ---------------------------------------------------------------------
create type health_band as enum ('green','yellow','red');

create table public.customer_health (
  id            uuid primary key default uuid_generate_v4(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  band          health_band not null,
  score         int check (score between 0 and 100),
  reason        text,                              -- George's natural-language rationale
  signals       jsonb not null default '{}'::jsonb,
  measured_at   timestamptz not null default now()
);

create index on public.customer_health (customer_id, measured_at desc);

-- ---------------------------------------------------------------------
-- Agent sessions, messages, memories
-- ---------------------------------------------------------------------
create table public.agent_sessions (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  customer_id     uuid references public.customers(id) on delete set null,
  title           text,
  -- Mirrors the Claude Agent SDK session_id so we can resume() correctly.
  sdk_session_id  text,
  channel         text not null default 'chat',    -- chat | voice | email | cron
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.agent_sessions (org_id, created_at desc);
create index on public.agent_sessions (sdk_session_id);

create trigger trg_agent_sessions_updated_at
  before update on public.agent_sessions
  for each row execute function public.set_updated_at();

create type agent_role as enum ('user','assistant','tool','system');

create table public.agent_messages (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid not null references public.agent_sessions(id) on delete cascade,
  role          agent_role not null,
  content       text,                              -- rendered text
  content_json  jsonb,                             -- full SDK block list when needed
  tool_name     text,
  tool_input    jsonb,
  tool_result   jsonb,
  tokens_in     int,
  tokens_out    int,
  created_at    timestamptz not null default now()
);

create index on public.agent_messages (session_id, created_at);

create type memory_scope as enum ('short','mid','long','agent','customer','org');

create table public.memories (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  customer_id   uuid references public.customers(id) on delete cascade,
  session_id    uuid references public.agent_sessions(id) on delete set null,
  scope         memory_scope not null,
  key           text,                              -- optional dedupe handle
  content       text not null,
  embedding     vector(1536),                      -- nullable; populated async
  importance    int default 0,
  metadata      jsonb not null default '{}'::jsonb,
  -- Pointer to mem0 record when we mirror long-term memories there.
  mem0_id       text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.memories (org_id, scope);
create index on public.memories (customer_id, scope);
create index memories_embedding_idx
  on public.memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create trigger trg_memories_updated_at
  before update on public.memories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Knowledge base (markdown-first, with embeddings for RAG)
-- ---------------------------------------------------------------------
create table public.knowledge_docs (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  path          text not null,                     -- e.g. 'onboarding/kickoff.md'
  title         text,
  content_md    text not null,
  source        text not null default 'manual',    -- 'manual' | 'sync:onedrive' | etc.
  version       int  not null default 1,
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, path)
);

create trigger trg_knowledge_docs_updated_at
  before update on public.knowledge_docs
  for each row execute function public.set_updated_at();

create table public.knowledge_chunks (
  id            uuid primary key default uuid_generate_v4(),
  doc_id        uuid not null references public.knowledge_docs(id) on delete cascade,
  org_id        uuid not null references public.orgs(id) on delete cascade,
  ordinal       int  not null,
  content       text not null,
  embedding     vector(1536),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index on public.knowledge_chunks (doc_id, ordinal);
create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------
-- Integrations (Composio first, native fallback)
-- ---------------------------------------------------------------------
create type integration_provider as enum (
  'composio',
  'm365',           -- direct Microsoft 365 (mail + calendar)
  'fireflies',
  'onedrive',
  'zoho',
  'gmail',
  'slack',
  'custom'
);

create type integration_status as enum ('connected','disconnected','error','pending');

create table public.integrations (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  provider        integration_provider not null,
  status          integration_status not null default 'pending',
  account_label   text,                            -- e.g. george@onyx mailbox
  -- Composio-backed: store connection id, scopes, last-sync metadata.
  external_id     text,
  metadata        jsonb not null default '{}'::jsonb,
  -- Encrypted credentials only when Composio isn't the broker. Use Supabase Vault.
  vault_secret_id text,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.integrations (org_id, provider);

create trigger trg_integrations_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Audit log — every externally-visible action George takes
-- ---------------------------------------------------------------------
create table public.audit_log (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  actor         text not null,                     -- 'george' | 'system' | user_id::text
  action        text not null,                     -- 'email.sent', 'meeting.scheduled', etc.
  customer_id   uuid references public.customers(id) on delete set null,
  session_id    uuid references public.agent_sessions(id) on delete set null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index on public.audit_log (org_id, created_at desc);
create index on public.audit_log (customer_id, created_at desc);
