--
-- PostgreSQL database dump
--

\restrict bNlqzAK12pD77aGYenkfdF31Lbnjpf9VvsWyQE0bHF58jFTTiSrHZKDtYdBrfWC

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: agent_event_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_event_status AS ENUM (
    'pending',
    'processing',
    'processed',
    'failed',
    'skipped'
);


--
-- Name: agent_job_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_job_run_status AS ENUM (
    'pending',
    'running',
    'succeeded',
    'failed',
    'timed_out'
);


--
-- Name: agent_job_run_trigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_job_run_trigger AS ENUM (
    'schedule',
    'manual'
);


--
-- Name: agent_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_role AS ENUM (
    'user',
    'assistant',
    'tool',
    'system'
);


--
-- Name: cadence_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cadence_channel AS ENUM (
    'call',
    'in_person',
    'email',
    'async'
);


--
-- Name: cadence_frequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cadence_frequency AS ENUM (
    'weekly',
    'biweekly',
    'monthly',
    'quarterly',
    'ad_hoc'
);


--
-- Name: contract_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contract_status AS ENUM (
    'draft',
    'signed',
    'active',
    'expired',
    'terminated'
);


--
-- Name: customer_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_kind AS ENUM (
    'partner',
    'end_customer'
);


--
-- Name: customer_lifecycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_lifecycle AS ENUM (
    'prospect',
    'onboarding',
    'active',
    'at_risk',
    'churned'
);


--
-- Name: email_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_direction AS ENUM (
    'inbound',
    'outbound'
);


--
-- Name: health_band; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.health_band AS ENUM (
    'green',
    'yellow',
    'red'
);


--
-- Name: integration_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integration_provider AS ENUM (
    'composio',
    'm365',
    'fireflies',
    'onedrive',
    'zoho',
    'gmail',
    'slack',
    'custom',
    'parchment'
);


--
-- Name: integration_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integration_status AS ENUM (
    'connected',
    'disconnected',
    'error',
    'pending'
);


--
-- Name: invite_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invite_status AS ENUM (
    'pending',
    'accepted',
    'revoked',
    'expired'
);


--
-- Name: memory_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.memory_scope AS ENUM (
    'short',
    'mid',
    'long',
    'agent',
    'customer',
    'org'
);


--
-- Name: objective_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.objective_kind AS ENUM (
    'standard',
    'from_meeting',
    'ad_hoc'
);


--
-- Name: objective_side; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.objective_side AS ENUM (
    'customer',
    'onyx'
);


--
-- Name: objective_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.objective_status AS ENUM (
    'pending',
    'awaiting',
    'achieved',
    'blocked',
    'cancelled'
);


--
-- Name: onboarding_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.onboarding_status AS ENUM (
    'planned',
    'in_progress',
    'blocked',
    'completed',
    'cancelled'
);


--
-- Name: match_knowledge_chunks(uuid, public.vector, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_knowledge_chunks(p_org_id uuid, p_query public.vector, p_limit integer DEFAULT 5) RETURNS TABLE(chunk_id uuid, doc_id uuid, ordinal integer, content text, similarity real, path text, title text, is_core boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    source text NOT NULL,
    source_event_id text,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.agent_event_status DEFAULT 'pending'::public.agent_event_status NOT NULL,
    session_id uuid,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    processed_at timestamp with time zone
);


--
-- Name: agent_job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_job_runs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    job_id uuid NOT NULL,
    org_id uuid NOT NULL,
    status public.agent_job_run_status DEFAULT 'pending'::public.agent_job_run_status NOT NULL,
    trigger public.agent_job_run_trigger NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    summary text,
    error text,
    sdk_session_id text,
    triggered_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_jobs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    directive text NOT NULL,
    cron text NOT NULL,
    timezone text,
    customer_id uuid,
    enabled boolean DEFAULT true NOT NULL,
    running_run_id uuid,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    role public.agent_role NOT NULL,
    content text,
    content_json jsonb,
    tool_name text,
    tool_input jsonb,
    tool_result jsonb,
    tokens_in integer,
    tokens_out integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_scan_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_scan_state (
    org_id uuid NOT NULL,
    kind text NOT NULL,
    last_run_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    user_id text,
    customer_id uuid,
    title text,
    sdk_session_id text,
    channel text DEFAULT 'chat'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    agent_slug text DEFAULT 'george'::text NOT NULL,
    name text DEFAULT 'George'::text NOT NULL,
    title text DEFAULT 'AI Customer Success Teammate'::text NOT NULL,
    bio text,
    personality text DEFAULT 'concise_direct'::text NOT NULL,
    operating_mode text DEFAULT 'assistant'::text NOT NULL,
    owner_user_id text,
    avatar_path text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    operating_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    knowledge_reviewers text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT agent_settings_operating_mode_check CHECK ((operating_mode = ANY (ARRAY['assistant'::text, 'operator'::text]))),
    CONSTRAINT agent_settings_personality_check CHECK ((personality = ANY (ARRAY['concise_direct'::text, 'warm_consultative'::text, 'formal'::text])))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    customer_id uuid,
    session_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cadences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cadences (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    org_id uuid NOT NULL,
    frequency public.cadence_frequency NOT NULL,
    day_of_week smallint,
    time_of_day time without time zone,
    timezone text,
    channel public.cadence_channel DEFAULT 'call'::public.cadence_channel NOT NULL,
    duration_min smallint,
    owner_user_id text,
    last_met_at timestamp with time zone,
    next_meeting_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cadences_day_of_week_check CHECK (((day_of_week IS NULL) OR ((day_of_week >= 0) AND (day_of_week <= 6)))),
    CONSTRAINT cadences_duration_min_check CHECK (((duration_min IS NULL) OR ((duration_min > 0) AND (duration_min <= 480))))
);


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    external_id text NOT NULL,
    calendar_external_id text,
    ical_uid text,
    subject text,
    body_preview text,
    body_html text,
    location text,
    is_all_day boolean DEFAULT false NOT NULL,
    is_cancelled boolean DEFAULT false NOT NULL,
    start_at timestamp with time zone,
    end_at timestamp with time zone,
    start_timezone text,
    end_timezone text,
    organizer_address text,
    organizer_name text,
    attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
    recurrence jsonb,
    series_master_external_id text,
    event_type text,
    online_meeting_url text,
    web_link text,
    response_status text,
    customer_id uuid,
    raw jsonb,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: calendars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendars (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    external_id text NOT NULL,
    name text,
    is_default boolean DEFAULT false NOT NULL,
    can_edit boolean DEFAULT false NOT NULL,
    backfill_cursor text,
    backfill_complete boolean DEFAULT false NOT NULL,
    delta_link text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    full_name text NOT NULL,
    title text,
    email text,
    phone text,
    is_primary boolean DEFAULT false NOT NULL,
    timezone text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    status public.contract_status DEFAULT 'signed'::public.contract_status NOT NULL,
    start_date date,
    end_date date,
    arr_cents bigint,
    currency text DEFAULT 'USD'::text,
    signed_at timestamp with time zone,
    storage_path text,
    summary text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_health (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    band public.health_band NOT NULL,
    score integer,
    reason text,
    signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    measured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_health_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    domain text,
    lifecycle public.customer_lifecycle DEFAULT 'prospect'::public.customer_lifecycle NOT NULL,
    industry text,
    size text,
    notes text,
    owner_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_kind public.customer_kind DEFAULT 'partner'::public.customer_kind NOT NULL,
    parent_customer_id uuid,
    CONSTRAINT customers_kind_parent_check CHECK ((((customer_kind = 'partner'::public.customer_kind) AND (parent_customer_id IS NULL)) OR ((customer_kind = 'end_customer'::public.customer_kind) AND (parent_customer_id IS NOT NULL))))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid,
    session_id uuid,
    uploaded_by text,
    storage_path text NOT NULL,
    original_name text NOT NULL,
    mime_type text NOT NULL,
    file_size integer NOT NULL,
    kind text,
    extracted_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: domain_allowlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.domain_allowlist (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    domain text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text,
    customer_id uuid,
    requested_by text,
    decided_by text,
    decided_at timestamp with time zone,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT domain_allowlist_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: email_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_attachments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    message_id uuid NOT NULL,
    external_id text NOT NULL,
    name text,
    content_type text,
    size_bytes bigint,
    is_inline boolean DEFAULT false NOT NULL,
    storage_path text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    external_id text NOT NULL,
    internet_message_id text,
    folder_external_id text,
    conversation_id text,
    direction public.email_direction NOT NULL,
    subject text,
    body_preview text,
    body_html text,
    body_content_type text,
    from_address text,
    from_name text,
    to_recipients jsonb DEFAULT '[]'::jsonb NOT NULL,
    cc_recipients jsonb DEFAULT '[]'::jsonb NOT NULL,
    bcc_recipients jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    is_draft boolean DEFAULT false NOT NULL,
    has_attachments boolean DEFAULT false NOT NULL,
    importance text,
    web_link text,
    received_at timestamp with time zone,
    sent_at timestamp with time zone,
    customer_id uuid,
    raw jsonb,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    flagged boolean DEFAULT false NOT NULL,
    flag_note text,
    processed_at timestamp with time zone,
    processed_session_id uuid
);


--
-- Name: escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escalations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid,
    session_id uuid,
    title text NOT NULL,
    detail text,
    recommendation text,
    urgency text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_by text,
    resolution text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    suggested_actions jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    provider public.integration_provider NOT NULL,
    status public.integration_status DEFAULT 'pending'::public.integration_status NOT NULL,
    account_label text,
    external_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    vault_secret_id text,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invites (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    role text DEFAULT 'csm'::text NOT NULL,
    invited_by text,
    status public.invite_status DEFAULT 'pending'::public.invite_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
    CONSTRAINT invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'csm'::text, 'sales'::text, 'viewer'::text])))
);


--
-- Name: knowledge_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_chunks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    doc_id uuid NOT NULL,
    org_id uuid NOT NULL,
    ordinal integer NOT NULL,
    content text NOT NULL,
    embedding public.vector(1536),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_docs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    path text NOT NULL,
    title text,
    content_md text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_core boolean DEFAULT false NOT NULL,
    concept_type text,
    description text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    resource text,
    links text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    proposed_by text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    CONSTRAINT knowledge_docs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'draft'::text, 'pending_review'::text, 'archived'::text])))
);


--
-- Name: knowledge_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_proposals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    path text NOT NULL,
    kind text DEFAULT 'create'::text NOT NULL,
    concept_type text,
    title text,
    description text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    links text[] DEFAULT '{}'::text[] NOT NULL,
    content_md text NOT NULL,
    source text DEFAULT 'chat'::text NOT NULL,
    source_ref text,
    rationale text,
    status text DEFAULT 'pending'::text NOT NULL,
    proposed_by text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_proposals_kind_check CHECK ((kind = ANY (ARRAY['create'::text, 'update'::text]))),
    CONSTRAINT knowledge_proposals_source_check CHECK ((source = ANY (ARRAY['chat'::text, 'email'::text, 'meeting'::text, 'instruction'::text, 'manual'::text]))),
    CONSTRAINT knowledge_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: mail_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mail_folders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    external_id text NOT NULL,
    parent_external_id text,
    display_name text NOT NULL,
    well_known_name text,
    total_item_count integer,
    unread_item_count integer,
    backfill_cursor text,
    backfill_complete boolean DEFAULT false NOT NULL,
    delta_link text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meeting_transcripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_transcripts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    external_id text NOT NULL,
    title text,
    status text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_min integer,
    attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
    transcript_text text,
    segment_count integer,
    insights jsonb,
    summary text,
    customer_id uuid,
    calendar_event_id uuid,
    meeting_url text,
    raw jsonb,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memories (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid,
    session_id uuid,
    scope public.memory_scope NOT NULL,
    key text,
    content text NOT NULL,
    embedding public.vector(1536),
    importance integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    mem0_id text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objectives (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    kind public.objective_kind DEFAULT 'ad_hoc'::public.objective_kind NOT NULL,
    status public.objective_status DEFAULT 'pending'::public.objective_status NOT NULL,
    responsible_side public.objective_side DEFAULT 'customer'::public.objective_side NOT NULL,
    responsible_contact_id uuid,
    owner_side_user_id text,
    cc_emails jsonb DEFAULT '[]'::jsonb NOT NULL,
    due_date date,
    followup_interval_hours integer DEFAULT 48 NOT NULL,
    next_followup_at timestamp with time zone,
    followup_count integer DEFAULT 0 NOT NULL,
    max_followups integer DEFAULT 2 NOT NULL,
    thread_conversation_id text,
    source_session_id uuid,
    achieved_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_plans (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    status public.onboarding_status DEFAULT 'planned'::public.onboarding_status NOT NULL,
    start_date date,
    target_end_date date,
    actual_end_date date,
    pace text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_steps (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    plan_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    ordinal integer NOT NULL,
    title text NOT NULL,
    description text,
    status public.onboarding_status DEFAULT 'planned'::public.onboarding_status NOT NULL,
    due_date date,
    completed_at timestamp with time zone,
    owner text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_members (
    org_id uuid NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    full_name text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text,
    locale text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'csm'::text, 'sales'::text, 'viewer'::text])))
);


--
-- Name: orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orgs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    domain text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    display_name text,
    customer_brand_name text,
    tagline text,
    brand_color text,
    default_timezone text DEFAULT 'America/Los_Angeles'::text,
    business_hours jsonb,
    logo_square_path text,
    logo_wordmark_path text,
    updated_by text,
    clerk_org_id text
);


--
-- Name: agent_events agent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_events
    ADD CONSTRAINT agent_events_pkey PRIMARY KEY (id);


--
-- Name: agent_job_runs agent_job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_job_runs
    ADD CONSTRAINT agent_job_runs_pkey PRIMARY KEY (id);


--
-- Name: agent_jobs agent_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_pkey PRIMARY KEY (id);


--
-- Name: agent_messages agent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);


--
-- Name: agent_scan_state agent_scan_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_scan_state
    ADD CONSTRAINT agent_scan_state_pkey PRIMARY KEY (org_id, kind);


--
-- Name: agent_sessions agent_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_pkey PRIMARY KEY (id);


--
-- Name: agent_settings agent_settings_org_id_agent_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_settings
    ADD CONSTRAINT agent_settings_org_id_agent_slug_key UNIQUE (org_id, agent_slug);


--
-- Name: agent_settings agent_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_settings
    ADD CONSTRAINT agent_settings_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: cadences cadences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadences
    ADD CONSTRAINT cadences_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_org_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_org_id_external_id_key UNIQUE (org_id, external_id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: calendars calendars_org_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendars
    ADD CONSTRAINT calendars_org_id_external_id_key UNIQUE (org_id, external_id);


--
-- Name: calendars calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendars
    ADD CONSTRAINT calendars_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: customer_health customer_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_health
    ADD CONSTRAINT customer_health_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: documents documents_org_id_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_storage_path_key UNIQUE (org_id, storage_path);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: domain_allowlist domain_allowlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_allowlist
    ADD CONSTRAINT domain_allowlist_pkey PRIMARY KEY (id);


--
-- Name: email_attachments email_attachments_message_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_message_id_external_id_key UNIQUE (message_id, external_id);


--
-- Name: email_attachments email_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_pkey PRIMARY KEY (id);


--
-- Name: email_messages email_messages_org_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_org_id_external_id_key UNIQUE (org_id, external_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);


--
-- Name: escalations escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id);


--
-- Name: knowledge_chunks knowledge_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id);


--
-- Name: knowledge_docs knowledge_docs_org_id_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_docs
    ADD CONSTRAINT knowledge_docs_org_id_path_key UNIQUE (org_id, path);


--
-- Name: knowledge_docs knowledge_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_docs
    ADD CONSTRAINT knowledge_docs_pkey PRIMARY KEY (id);


--
-- Name: knowledge_proposals knowledge_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_proposals
    ADD CONSTRAINT knowledge_proposals_pkey PRIMARY KEY (id);


--
-- Name: mail_folders mail_folders_org_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_folders
    ADD CONSTRAINT mail_folders_org_id_external_id_key UNIQUE (org_id, external_id);


--
-- Name: mail_folders mail_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_folders
    ADD CONSTRAINT mail_folders_pkey PRIMARY KEY (id);


--
-- Name: meeting_transcripts meeting_transcripts_org_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_org_id_external_id_key UNIQUE (org_id, external_id);


--
-- Name: meeting_transcripts meeting_transcripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_pkey PRIMARY KEY (id);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (id);


--
-- Name: objectives objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_pkey PRIMARY KEY (id);


--
-- Name: onboarding_plans onboarding_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_plans
    ADD CONSTRAINT onboarding_plans_pkey PRIMARY KEY (id);


--
-- Name: onboarding_steps onboarding_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_pkey PRIMARY KEY (id);


--
-- Name: onboarding_steps onboarding_steps_plan_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_plan_id_ordinal_key UNIQUE (plan_id, ordinal);


--
-- Name: org_members org_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_pkey PRIMARY KEY (org_id, user_id);


--
-- Name: orgs orgs_clerk_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_clerk_org_id_key UNIQUE (clerk_org_id);


--
-- Name: orgs orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);


--
-- Name: agent_events_org_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_events_org_status_created_idx ON public.agent_events USING btree (org_id, status, created_at DESC);


--
-- Name: agent_events_pending_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_events_pending_created_idx ON public.agent_events USING btree (created_at) WHERE (status = 'pending'::public.agent_event_status);


--
-- Name: agent_events_source_dedupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_events_source_dedupe_idx ON public.agent_events USING btree (org_id, source, source_event_id) WHERE (source_event_id IS NOT NULL);


--
-- Name: agent_job_runs_job_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_job_runs_job_id_started_at_idx ON public.agent_job_runs USING btree (job_id, started_at DESC);


--
-- Name: agent_job_runs_org_id_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_job_runs_org_id_started_at_idx ON public.agent_job_runs USING btree (org_id, started_at DESC);


--
-- Name: agent_jobs_enabled_next_run_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_jobs_enabled_next_run_at_idx ON public.agent_jobs USING btree (enabled, next_run_at) WHERE enabled;


--
-- Name: agent_jobs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_jobs_org_id_idx ON public.agent_jobs USING btree (org_id);


--
-- Name: agent_messages_session_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_messages_session_id_created_at_idx ON public.agent_messages USING btree (session_id, created_at);


--
-- Name: agent_sessions_org_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_sessions_org_id_created_at_idx ON public.agent_sessions USING btree (org_id, created_at DESC);


--
-- Name: agent_sessions_sdk_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_sessions_sdk_session_id_idx ON public.agent_sessions USING btree (sdk_session_id);


--
-- Name: agent_settings_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_settings_org_idx ON public.agent_settings USING btree (org_id);


--
-- Name: audit_log_customer_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_customer_id_created_at_idx ON public.audit_log USING btree (customer_id, created_at DESC);


--
-- Name: audit_log_org_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_org_id_created_at_idx ON public.audit_log USING btree (org_id, created_at DESC);


--
-- Name: cadences_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cadences_customer_idx ON public.cadences USING btree (customer_id, active);


--
-- Name: cadences_one_active_per_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cadences_one_active_per_customer ON public.cadences USING btree (customer_id) WHERE active;


--
-- Name: cadences_org_next_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cadences_org_next_idx ON public.cadences USING btree (org_id, next_meeting_at) WHERE active;


--
-- Name: calendar_events_calendar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_calendar_idx ON public.calendar_events USING btree (org_id, calendar_external_id);


--
-- Name: calendar_events_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_customer_idx ON public.calendar_events USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: calendar_events_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_window_idx ON public.calendar_events USING btree (org_id, start_at);


--
-- Name: calendars_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendars_org_idx ON public.calendars USING btree (org_id);


--
-- Name: contacts_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_customer_id_idx ON public.contacts USING btree (customer_id);


--
-- Name: contacts_one_primary_per_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contacts_one_primary_per_customer ON public.contacts USING btree (customer_id) WHERE is_primary;


--
-- Name: contracts_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contracts_customer_id_idx ON public.contracts USING btree (customer_id);


--
-- Name: customer_health_customer_id_measured_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_health_customer_id_measured_at_idx ON public.customer_health USING btree (customer_id, measured_at DESC);


--
-- Name: customers_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_kind_idx ON public.customers USING btree (org_id, customer_kind);


--
-- Name: customers_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_lifecycle_idx ON public.customers USING btree (lifecycle);


--
-- Name: customers_org_domain_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_org_domain_unique ON public.customers USING btree (org_id, lower(domain)) WHERE (domain IS NOT NULL);


--
-- Name: customers_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_org_id_idx ON public.customers USING btree (org_id);


--
-- Name: customers_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_parent_idx ON public.customers USING btree (parent_customer_id) WHERE (parent_customer_id IS NOT NULL);


--
-- Name: documents_customer_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_customer_id_created_at_idx ON public.documents USING btree (customer_id, created_at DESC);


--
-- Name: documents_org_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_org_id_created_at_idx ON public.documents USING btree (org_id, created_at DESC);


--
-- Name: documents_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_session_id_idx ON public.documents USING btree (session_id);


--
-- Name: domain_allowlist_org_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX domain_allowlist_org_domain_idx ON public.domain_allowlist USING btree (org_id, lower(domain));


--
-- Name: domain_allowlist_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX domain_allowlist_org_status_idx ON public.domain_allowlist USING btree (org_id, status);


--
-- Name: email_attachments_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_attachments_org_idx ON public.email_attachments USING btree (org_id);


--
-- Name: email_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_conversation_idx ON public.email_messages USING btree (org_id, conversation_id);


--
-- Name: email_messages_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_customer_idx ON public.email_messages USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: email_messages_flagged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_flagged_idx ON public.email_messages USING btree (org_id) WHERE flagged;


--
-- Name: email_messages_folder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_folder_idx ON public.email_messages USING btree (org_id, folder_external_id);


--
-- Name: email_messages_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_recent_idx ON public.email_messages USING btree (org_id, received_at DESC);


--
-- Name: escalations_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalations_customer_idx ON public.escalations USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: escalations_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalations_open_idx ON public.escalations USING btree (org_id, created_at DESC) WHERE (status = 'open'::text);


--
-- Name: integrations_org_id_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integrations_org_id_provider_idx ON public.integrations USING btree (org_id, provider);


--
-- Name: integrations_org_provider_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX integrations_org_provider_unique ON public.integrations USING btree (org_id, provider);


--
-- Name: invites_org_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invites_org_id_status_idx ON public.invites USING btree (org_id, status);


--
-- Name: invites_unique_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invites_unique_pending ON public.invites USING btree (org_id, lower(email)) WHERE (status = 'pending'::public.invite_status);


--
-- Name: knowledge_chunks_doc_id_ordinal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_doc_id_ordinal_idx ON public.knowledge_chunks USING btree (doc_id, ordinal);


--
-- Name: knowledge_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_embedding_idx ON public.knowledge_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: knowledge_docs_org_is_core_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_docs_org_is_core_idx ON public.knowledge_docs USING btree (org_id, is_core);


--
-- Name: knowledge_docs_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_docs_org_status_idx ON public.knowledge_docs USING btree (org_id, status);


--
-- Name: knowledge_docs_org_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_docs_org_type_idx ON public.knowledge_docs USING btree (org_id, concept_type);


--
-- Name: knowledge_docs_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_docs_tags_gin ON public.knowledge_docs USING gin (tags);


--
-- Name: knowledge_proposals_org_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_proposals_org_status_idx ON public.knowledge_proposals USING btree (org_id, status, created_at DESC);


--
-- Name: mail_folders_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mail_folders_org_idx ON public.mail_folders USING btree (org_id);


--
-- Name: meeting_transcripts_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_transcripts_customer_idx ON public.meeting_transcripts USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: meeting_transcripts_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_transcripts_recent_idx ON public.meeting_transcripts USING btree (org_id, ended_at DESC);


--
-- Name: memories_customer_id_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_customer_id_scope_idx ON public.memories USING btree (customer_id, scope);


--
-- Name: memories_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_embedding_idx ON public.memories USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: memories_org_id_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memories_org_id_scope_idx ON public.memories USING btree (org_id, scope);


--
-- Name: objectives_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX objectives_customer_idx ON public.objectives USING btree (customer_id, status);


--
-- Name: objectives_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX objectives_due_idx ON public.objectives USING btree (next_followup_at) WHERE (status = 'awaiting'::public.objective_status);


--
-- Name: objectives_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX objectives_org_idx ON public.objectives USING btree (org_id, status);


--
-- Name: onboarding_one_active_per_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX onboarding_one_active_per_customer ON public.onboarding_plans USING btree (customer_id) WHERE (status = ANY (ARRAY['planned'::public.onboarding_status, 'in_progress'::public.onboarding_status, 'blocked'::public.onboarding_status]));


--
-- Name: onboarding_steps_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_steps_customer_id_idx ON public.onboarding_steps USING btree (customer_id);


--
-- Name: onboarding_steps_plan_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX onboarding_steps_plan_id_status_idx ON public.onboarding_steps USING btree (plan_id, status);


--
-- Name: org_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_members_user_id_idx ON public.org_members USING btree (user_id);


--
-- Name: agent_jobs trg_agent_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agent_jobs_updated_at BEFORE UPDATE ON public.agent_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: agent_scan_state trg_agent_scan_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agent_scan_state_updated_at BEFORE UPDATE ON public.agent_scan_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: agent_sessions trg_agent_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agent_sessions_updated_at BEFORE UPDATE ON public.agent_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: agent_settings trg_agent_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agent_settings_updated_at BEFORE UPDATE ON public.agent_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cadences trg_cadences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cadences_updated_at BEFORE UPDATE ON public.cadences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: calendar_events trg_calendar_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendar_events_updated_at BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: calendars trg_calendars_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendars_updated_at BEFORE UPDATE ON public.calendars FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: contacts trg_contacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: contracts trg_contracts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers trg_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: domain_allowlist trg_domain_allowlist_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_domain_allowlist_updated_at BEFORE UPDATE ON public.domain_allowlist FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_messages trg_email_messages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_email_messages_updated_at BEFORE UPDATE ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: escalations trg_escalations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_escalations_updated_at BEFORE UPDATE ON public.escalations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: integrations trg_integrations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: knowledge_docs trg_knowledge_docs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_knowledge_docs_updated_at BEFORE UPDATE ON public.knowledge_docs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: knowledge_proposals trg_knowledge_proposals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_knowledge_proposals_updated_at BEFORE UPDATE ON public.knowledge_proposals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mail_folders trg_mail_folders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mail_folders_updated_at BEFORE UPDATE ON public.mail_folders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: meeting_transcripts trg_meeting_transcripts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_meeting_transcripts_updated_at BEFORE UPDATE ON public.meeting_transcripts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: memories trg_memories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_memories_updated_at BEFORE UPDATE ON public.memories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: objectives trg_objectives_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_objectives_updated_at BEFORE UPDATE ON public.objectives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: onboarding_plans trg_onboarding_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_onboarding_plans_updated_at BEFORE UPDATE ON public.onboarding_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: onboarding_steps trg_onboarding_steps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_onboarding_steps_updated_at BEFORE UPDATE ON public.onboarding_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: org_members trg_org_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON public.org_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: orgs trg_orgs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orgs_updated_at BEFORE UPDATE ON public.orgs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: agent_events agent_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_events
    ADD CONSTRAINT agent_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: agent_events agent_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_events
    ADD CONSTRAINT agent_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;


--
-- Name: agent_job_runs agent_job_runs_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_job_runs
    ADD CONSTRAINT agent_job_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.agent_jobs(id) ON DELETE CASCADE;


--
-- Name: agent_job_runs agent_job_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_job_runs
    ADD CONSTRAINT agent_job_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: agent_jobs agent_jobs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: agent_jobs agent_jobs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: agent_jobs agent_jobs_running_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_running_run_id_fkey FOREIGN KEY (running_run_id) REFERENCES public.agent_job_runs(id) ON DELETE SET NULL;


--
-- Name: agent_messages agent_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_sessions(id) ON DELETE CASCADE;


--
-- Name: agent_scan_state agent_scan_state_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_scan_state
    ADD CONSTRAINT agent_scan_state_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: agent_sessions agent_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: agent_sessions agent_sessions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: agent_settings agent_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_settings
    ADD CONSTRAINT agent_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;


--
-- Name: cadences cadences_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadences
    ADD CONSTRAINT cadences_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: cadences cadences_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadences
    ADD CONSTRAINT cadences_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: calendars calendars_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendars
    ADD CONSTRAINT calendars_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_health customer_health_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_health
    ADD CONSTRAINT customer_health_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customers customers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: customers customers_parent_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_parent_customer_id_fkey FOREIGN KEY (parent_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: documents documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: documents documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: documents documents_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;


--
-- Name: domain_allowlist domain_allowlist_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_allowlist
    ADD CONSTRAINT domain_allowlist_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: domain_allowlist domain_allowlist_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.domain_allowlist
    ADD CONSTRAINT domain_allowlist_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: email_attachments email_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;


--
-- Name: email_attachments email_attachments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: email_messages email_messages_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: email_messages email_messages_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: email_messages email_messages_processed_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_processed_session_id_fkey FOREIGN KEY (processed_session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;


--
-- Name: escalations escalations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: escalations escalations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: escalations escalations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;


--
-- Name: integrations integrations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: invites invites_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_doc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.knowledge_docs(id) ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: knowledge_docs knowledge_docs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_docs
    ADD CONSTRAINT knowledge_docs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: knowledge_proposals knowledge_proposals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_proposals
    ADD CONSTRAINT knowledge_proposals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: mail_folders mail_folders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mail_folders
    ADD CONSTRAINT mail_folders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: meeting_transcripts meeting_transcripts_calendar_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_calendar_event_id_fkey FOREIGN KEY (calendar_event_id) REFERENCES public.calendar_events(id) ON DELETE SET NULL;


--
-- Name: meeting_transcripts meeting_transcripts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: meeting_transcripts meeting_transcripts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: memories memories_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: memories memories_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: memories memories_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;


--
-- Name: objectives objectives_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: objectives objectives_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: objectives objectives_responsible_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_responsible_contact_id_fkey FOREIGN KEY (responsible_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: objectives objectives_source_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_source_session_id_fkey FOREIGN KEY (source_session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;


--
-- Name: onboarding_plans onboarding_plans_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_plans
    ADD CONSTRAINT onboarding_plans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: onboarding_steps onboarding_steps_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: onboarding_steps onboarding_steps_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.onboarding_plans(id) ON DELETE CASCADE;


--
-- Name: org_members org_members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict bNlqzAK12pD77aGYenkfdF31Lbnjpf9VvsWyQE0bHF58jFTTiSrHZKDtYdBrfWC

