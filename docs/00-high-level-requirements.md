# Agent George — High-Level Requirements

**Status:** Draft v0.1
**Last updated:** 2026-05-12
**Author:** Rahul Bhavsar
**Customer (first deployment):** Onyx — `getonyx.ai`

---

## 1. Vision

Build **Agent George**, an AI employee that serves as a **Customer Success Manager (CSM)** for a tech / software company. George is not a SaaS dashboard with hundreds of screens. It is an **agent-harness multi-agent system** where:

- The human (CSM, sales rep, leader) interacts with George primarily through **chat and voice**, like Claude or ChatGPT.
- George holds the operating knowledge of the company in its head (knowledge base + memory).
- George works **proactively and reactively** across onboarding, customer health/retention, and on-demand support.
- Minimal screens exist only to view and lightly edit structured state; everything else is conducted via the conversation surface.

George is delivered as an AI employee identity — its own name, its own email account, and its own calendar.

## 2. Scope (v1)

In scope for the first release:

1. **Onboarding journey** — driving a signed customer through every step from contract intake to fully onboarded users.
2. **Customer health / retention** — proactive cadence, utilization tracking, risk signals, scheduled check-ins.
3. **The chat/voice agent surface** for the human user (CSM / sales rep).
4. **A minimal dashboard + settings + user management UI.**
5. **Knowledge base management** (markdown-backed) for company-specific process and best practices.
6. **Agent identity** — email + calendar for George.

Explicitly **out of scope for v1** (revisited later):

- The full on-demand support workflow for end users (planned for v2+).
- A complex SaaS-style admin UI with screens for every entity.
- Anything that duplicates what the agent can do conversationally.

## 3. Core Functions

George performs three core functions. v1 focuses on the first two.

### 3.1 Onboarding
A signed customer is moved through a mutually agreed project plan. George:
- Ingests the contract, NDA, and other artifacts (drop into chat).
- Captures contacts, contract terms, contract length, billing cadence, contact persons.
- Captures the mutually agreed onboarding plan (timeline, pace, milestones).
- Drives each well-defined step in sequence, daily and weekly.
- Reminds the human and the customer, captures progress, updates state.

### 3.2 Customer Health & Retention
After onboarding:
- George runs the agreed cadence (e.g. weekly / biweekly / monthly).
- Pulls utilization stats automatically.
- Prepares cadence decks ahead of every call.
- Surfaces risk signals (declining usage, unresolved flags, stalled accounts).
- Runs 30 / 60 / 90 day Success Sprint check-ins.

### 3.3 On-Demand Support *(v2+)*
Out of scope for v1. Will cover inbound questions from partner admins / end customers via chat or email.

## 4. Users & Roles

| Role | Description | Primary surface |
|---|---|---|
| **CSM (human operator)** | Manages Agent George; consumes its reports; gives it direction; approves consequential actions. | Chat/voice + minimal dashboard. |
| **Sales rep** | Hands signed contracts/NDAs to George to start onboarding. | Chat + email to George. |
| **Leader / admin** | Configures knowledge base, manages users, reviews portfolio. | Settings UI + chat. |
| **Customer contact (partner admin / end customer)** | Receives George's emails, reminders, and meeting invites. Future: may chat with a derived bot. | Email / calendar / future chatbot. |

The **primary user of George is the CSM.** Everyone else either feeds George or receives George's output.

## 5. System Architecture (Target)

### 5.1 Agent Layer
- **Main orchestration agent** — Claude Agent SDK, runs the conversation, holds session state, decides what tools and sub-agents to invoke.
- **Short-lived sub-agents** — spawned by the Claude Agent SDK for parallel research, document parsing, or analysis tasks within a session.
- **Long-running cloud-managed agents** — used for jobs that exceed a session: scheduled daily/weekly tasks, multi-hour analyses, monitoring loops.
- **Proactive scheduler** — George knows its standing jobs (e.g. "every morning at 8am pull utilization for active partners and check for stalled onboarding steps"). These run autonomously and report results back to the orchestration agent.

### 5.2 UI Layer
- Next.js app (already scaffolded in `george/`).
- **Conversation surface**: chat + voice, primary interaction.
- **Minimal dashboard**: a small set of read/edit screens — customer records, contracts, contact persons, project plan, onboarding stage, knowledge base, settings, user management.
- All record creation flows enter the system through chat (e.g. "here is the signed contract" → George extracts everything and creates the record).

### 5.3 Data Layer — Supabase (from day one)
- **Database** — Postgres on `supabase.com` (no local Docker, no self-hosted).
- **Authentication** — Supabase Auth.
- **Edge Functions** — used for any server-side work that should live close to the data.
- All structured state (customers, contacts, contracts, project plans, onboarding stages, health metrics, memory, etc.) lives in Supabase tables.

### 5.4 Integrations — Composio first
- **Composio is the default integration layer.** Any external SaaS (Microsoft 365, Zoho, Fireflies, OneDrive, Google Calendar, etc.) is reached through Composio.
- Direct integrations are built **only when Composio does not cover** the required capability.

### 5.5 Identity for George
- George has its **own Microsoft 365 account**: email + calendar.
- Email and calendar are synced through Composio (M365 connector).
- George can: send/receive/reply to email, create calendar events, set reminders, and react to scheduled events.

### 5.6 Meeting / Note-Taker Integration
- George does **not** join meetings directly.
- The recommended note-taker is **Fireflies**.
- George ingests the meeting transcript and outputs from Fireflies (via Composio) and acts on them: updates the customer record, follows up on action items, adjusts the project plan.

### 5.7 Knowledge Base
- Stored as **markdown files** (under `knowledge/` in the repo today) — the source-of-truth for company process, best practices, and onboarding steps.
- For runtime use we will evaluate, in order: (a) keep as markdown loaded into the agent's context for small KBs, (b) move to a Supabase-backed RAG (embeddings + pgvector) as the KB grows, (c) hybrid (markdown for editing + indexed copy for retrieval).
- **Decision needed:** KB storage strategy. Default position for v1: markdown in repo + Supabase pgvector for retrieval, with markdown as the editable source.

### 5.8 Memory System

A layered memory system across:

| Layer | Lifetime | Backed by | Examples |
|---|---|---|---|
| **Interaction memory** | A single turn | In-process | The user's last message and immediate tool output. |
| **Session memory** | One conversation | In-process + Supabase session row | What the CSM and George have discussed in this chat. |
| **Short-term memory** | Hours to a few days | Supabase | Current onboarding focus, today's standing tasks. |
| **Mid-term memory** | Weeks | Supabase | Cadence rhythm with a customer, recent themes. |
| **Long-term memory** | Indefinite | **mem0** (primary) + Supabase tables for relational facts | Customer preferences, lessons learned, stable facts. |
| **Agent-level memory** | Per agent identity | mem0 | George's own operating preferences and learned behaviors. |

mem0 is the primary long-term memory store. Supabase tables hold structured, relational memory (e.g. "customer X agreed to a biweekly cadence on date Y").

## 6. Onboarding Workflow (v1 Behavior)

This is the canonical flow Agent George executes for every new customer.

1. **Intake via chat or email.** Sales rep drops the signed contract + NDA into chat with George, or forwards them to George's email.
2. **Document understanding.** George parses the documents and extracts: customer name, contract term, pricing, billing cadence, included scope.
3. **Clarifying questions.** George asks for any missing fields conversationally — primary contact person, name, email, phone, title.
4. **Customer record created** in Supabase (customer + contacts + contract).
5. **Kickoff planning.** George identifies attendees, proposes times via its calendar, sends the invite from its M365 account, recommends Fireflies as the note-taker.
6. **Kickoff meeting (George does not attend).** Fireflies records the meeting.
7. **Post-kickoff ingestion.** George fetches the Fireflies transcript, extracts the agreed project plan, milestones, owners, and start date, and stores it against the customer.
8. **Daily/weekly execution.** George follows the agreed plan: chases data, sends reminders, updates stages, captures responses to its emails, reports progress back to the human CSM.
9. **Health monitoring rollover.** Once onboarding is complete, the customer moves into the health/cadence phase (see §3.2).

## 7. Customer Record (Conceptual Shape)

What lives against every customer (exact schema in §10):

- Identification: name, domain, industry.
- Commercial: contract term, start date, end date, pricing, billing cadence, scope/hubs included.
- Contacts: primary admin (name, email, phone, title), additional contacts.
- Onboarding project plan: milestones with target dates, owners, status.
- Onboarding stage: which step of the canonical flow the customer is currently in.
- Cadence: meeting frequency, day/time, channel.
- Health: latest utilization snapshot, open flags, risk score.
- Activity / log: every meaningful action George has taken for this customer.

## 8. Settings & Knowledge Management

The CSM / admin can:

- View and edit the **knowledge base** (markdown content).
- Add new markdown documents to the KB.
- See which documents are indexed for retrieval.
- Manage users (invite, role, deactivate).
- See George's identity settings (email, calendar account, integrations).

All of this is editable through chat as well — the UI is a convenience, not the only path.

## 9. Proactive Behavior

George is not a chatbot that only answers questions. It must:

- Maintain a list of **standing jobs** (daily / weekly / event-driven).
- Run them on schedule using cloud-managed agents.
- Validate the result, update Supabase, and surface anything notable to the CSM.
- Take initiative: schedule kickoffs, send reminders, draft replies, escalate stalled steps.

Examples of standing jobs:
- Each morning: pull utilization deltas for active customers; flag anomalies.
- Each Monday: prep cadence decks for the week's scheduled calls.
- Hourly: scan George's inbox; reply to or escalate new messages.
- On contract intake: kick off the onboarding sequence end to end.

## 10. Data Model (Initial Sketch)

Tables to create in Supabase (v1):

- `users` — internal Onyx team members (CSMs, sales, admins). Links to Supabase Auth.
- `customers` — partner / customer entities being onboarded and managed.
- `contacts` — people at each customer (admin, billing, etc.).
- `contracts` — signed commercial documents; references the customer.
- `documents` — raw artifacts ingested (contract, NDA, order form), with extracted fields and links to storage.
- `project_plans` — mutually agreed onboarding plan per customer.
- `project_plan_steps` — individual steps with target date, owner, status.
- `onboarding_stages` — current stage of each customer in the canonical flow.
- `cadence` — meeting frequency, channel, last met, next meeting per customer.
- `meetings` — meetings scheduled or held; links to Fireflies transcript when available.
- `emails` — emails to/from George's mailbox (synced via Composio).
- `health_snapshots` — periodic utilization & risk snapshots per customer.
- `flags` — in-app or escalated issues per customer.
- `activity_log` — append-only log of George's actions per customer.
- `kb_documents` — knowledge-base markdown documents (metadata; content in storage or column).
- `kb_chunks` — embedded chunks for retrieval (pgvector).
- `memory_short_term`, `memory_mid_term` — Supabase-backed memory layers.
- `agent_jobs` — standing jobs and their schedules.
- `agent_job_runs` — execution history of each job.
- `sessions`, `messages` — conversation surface with George.

Long-term memory and agent-level memory live in **mem0**, not in these tables.

## 11. Tech Stack Summary

| Layer | Choice |
|---|---|
| Frontend | Next.js (scaffolded in `george/`) |
| Design system | AIX Core (see `design/design-system.md`) |
| Agent runtime | Claude Agent SDK |
| Long-running agents | Claude Managed Agents (cloud) |
| Database / Auth / Edge | Supabase (`supabase.com`, hosted — no local Docker) |
| Long-term memory | mem0 |
| Integrations | Composio (M365, Fireflies, Zoho, OneDrive, etc.) |
| Direct integrations | Only when Composio does not cover the need |
| Knowledge base | Markdown in repo + Supabase pgvector for retrieval (to be confirmed) |
| Email + calendar identity | Microsoft 365 account for Agent George (synced via Composio) |
| Meeting note-taker | Fireflies (customer side) |

## 12. Build Order (Proposed)

The user's stated order for the first slice:

1. **Main dashboard** (minimal, per design system).
2. **Agent George chat experience** powered by Claude Agent SDK.
3. **Supabase project** created on `supabase.com`, connected from day one.
4. **Database schema** designed and migrated based on §10.

Subsequent slices (not in this first build):

5. Document ingestion via chat (contract / NDA drop).
6. Customer record creation flow through chat.
7. Microsoft 365 identity wiring for George (Composio).
8. Fireflies integration (Composio).
9. mem0 wiring + memory layers.
10. Standing jobs / scheduler.
11. Knowledge base editing UI.

## 13. Open Questions

- **KB storage**: markdown-only vs pgvector RAG vs hybrid. Default leaning: hybrid.
- **Voice transport**: which provider for the voice surface (browser-native vs a streaming TTS/STT service).
- **Authorization model**: how granular do per-customer / per-action permissions need to be in v1?
- **Composio coverage**: confirm Composio supports M365 mail + calendar at the depth George needs (full send/reply, calendar event CRUD, free/busy lookup).
- **Fireflies integration via Composio**: confirm transcript fetch and webhook support; otherwise build direct.
- **Approval boundary**: which George actions require an explicit human confirmation (sending external email, creating calendar invites to external attendees, modifying a contract record, etc.).
- **Tenancy**: is George multi-tenant from v1 (Onyx is just the first tenant) or single-tenant for Onyx with multi-tenancy added later?

## 14. Glossary

- **Customer / Partner** — the business that signed a contract with the company George works for.
- **Contact** — a person at a customer.
- **CSM** — Customer Success Manager, the human operator George reports to.
- **Onboarding stage** — the current step of the canonical onboarding sequence.
- **Project plan** — the mutually agreed timeline for a specific customer's onboarding.
- **Cadence** — agreed recurring meeting rhythm with a customer post-onboarding.
- **Standing job** — a scheduled task George runs on its own.
- **Knowledge base (KB)** — markdown-backed company knowledge George uses to operate.

---

This document is the v1 high-level brief. It will evolve as we build, particularly §5 (architecture), §10 (data model), and §13 (open questions).
