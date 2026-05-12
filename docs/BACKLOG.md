# Backlog

Living list of work we've deliberately deferred. Anything here is a "yes, we'll do this — just not now." Add to it whenever we punt on something; clear an item by either shipping it or explicitly killing it.

Sections grouped by area. Each item: **what / why / where / status**.

Cross-walk: this list is reconciled against `docs/00-high-level-requirements.md`. New items added during HLR review on 2026-05-12 are tagged **[HLR]**.

---

## Composio + agent autonomy

### 1. Inbound-email auto-respond loop
**What:** When a customer emails `george@onyx.ai`, the Composio `OUTLOOK_NEW_MESSAGE` trigger fires our webhook → we spawn a George `query()` session with the email content as input → George decides (reply, route to human, no-op), drafts a reply, surfaces it for human review (default) or sends autonomously for known low-stakes threads (opt-in).

**Why deferred:** Needs (a) a publicly-reachable webhook URL — ngrok in dev or a Vercel preview deploy, (b) a server-side "spawn agent from non-chat context" path (today `query()` is only called from the route handler), (c) thread-aware persistence so we can store inbound mail per customer for the timeline.

**Where:** `src/app/api/webhooks/composio/route.ts` (currently observation-only — writes to `audit_log` then 200s). The `query()` invocation pattern is in `src/app/api/chat/route.ts`.

**Status:** **Internal infra shipped (v1, 2026-05-12).** End-to-end gated on configuring the Composio trigger and verifying real-payload field paths.

What's in place:
- Migration `20260515000600_agent_events.sql` adds `agent_events` (org-scoped, dedupe via unique partial index on `(org_id, source, source_event_id)`, status pending→processing→processed/failed/skipped, FK to `agent_sessions`). **Apply before testing.**
- `src/lib/agent/system-prompt.ts` — shared builder for chat + autonomous modes (manifest pattern). Fixed `run-job.ts`'s stale eager-load drift along the way.
- `src/lib/agent/run-autonomous.ts` — generic autonomous runner: strips `send_email_draft`, excludes `AskUserQuestion`, hard wall-time budget, time-out / failure / success surface. `run-job.ts` is now a thin wrapper around it.
- `src/lib/agent/process-event.ts` — atomic-claim event processor: creates a `channel='email'` agent_sessions row, seeds an inbound `agent_messages` row so the reviewer sees the email in chat, runs George autonomously, persists the structured summary as an assistant message, links `sdk_session_id` so chat resume works (and the human can type "send it" to trigger `send_email_draft` in chat mode). Outlook payload parser tries multiple Composio envelope shapes defensively — final field paths need real-delivery verification.
- `src/app/api/webhooks/composio/route.ts` — verifies signature (hard-fails in prod when secret unset per #4), persists event row idempotently (23505 = duplicate delivery, returns ok), returns 200 fast, fires `after(...) → processAgentEvent`. Always logs to `audit_log` regardless of event type for diagnosis.
- `src/app/api/cron/run-jobs/route.ts` — same hourly tick now also sweeps `agent_events.status='pending'` rows older than 5 min, processing up to 5 per tick (belt-and-braces for cold-killed after-handlers).
- `src/app/(app)/chat/_history-rail.tsx` — surfaces `channel='email'` sessions in the existing rail with a Mail icon. No dedicated inbox page (deferred).

Verification gates remaining before this can fire end-to-end:
1. Apply migration `20260515000600_agent_events.sql`.
2. Configure the `OUTLOOK_NEW_MESSAGE` trigger in Composio pointing at `https://<deploy>/api/webhooks/composio` with `userId=org-<orgId>`.
3. Set `COMPOSIO_WEBHOOK_SECRET` in prod env.
4. Send one real email and inspect the captured `agent_events.payload` to confirm `extractOutlookMessage` field-path candidates cover Composio's actual envelope; tighten the parser if not.

---

### 2. Inbound-Fireflies transcript ingestion
**What:** Same shape as #1 but for Fireflies `TRANSCRIPT_READY` triggers. After every kickoff / check-in George didn't attend, he automatically pulls the transcript, extracts decisions + action items + dates, updates the onboarding plan, drafts a recap email.

**Why deferred:** Same webhook infra dependency as #1. Also needs a stable transcript → customer mapping (match by attendee emails to `contacts.email`).

**Where:** `src/app/api/webhooks/composio/route.ts` would dispatch on `body.type === "FIREFLIES_TRANSCRIPT_READY"`.

**Status:** Pending. Behind #1.

---

### 3. Autonomous email policy
**What:** Today the prompt forces "draft → user confirms → send." Add a config — per customer or per thread — that allows George to send certain low-stakes replies without confirmation (e.g. "I'll send the kickoff agenda this afternoon" → no review). Tied to the inbound webhook flow.

**Why deferred:** Right confirmation policy is a product decision we should make after observing real drafts for a week.

**Where:** Would extend `src/lib/agent/prompt.ts` + add an `email_policy` jsonb column on `customers` or a new `agent_policies` table.

**Status:** Idea.

---

### 4. Composio webhook signature in dev
**What:** Currently `verifyComposioSignature` accepts unsigned requests when `COMPOSIO_WEBHOOK_SECRET` is unset (with a log warning). That's fine for local but needs to be a hard fail in production.

**Where:** `src/lib/agent/composio-tools.ts` / `src/app/api/webhooks/composio/route.ts`.

**Status:** Shipped 2026-05-12 as part of #1. `verifyComposioSignature` now hard-rejects (returns 401) when `NODE_ENV='production'` and the secret is unset; the warn-then-accept path is dev-only.

---

## Knowledge + memory

### 5. Real embeddings for `search_knowledge`
**What:** Replace JS-side multi-word ilike scoring with proper vector similarity. Populate `knowledge_chunks.embedding` (1536-dim) at sync time using OpenAI `text-embedding-3-small` (or Voyage-3-small w/ schema bump). Swap `search_knowledge` to a SQL function that does `embedding <=> query_embedding` cosine distance.

**Why deferred:** Needs an embedding-provider API key (OpenAI or Voyage). Ilike works fine for ~13 chunks today.

**Where:** `scripts/sync-knowledge.ts` (populate embedding), `src/lib/agent/tools.ts` `searchKnowledge` (replace ilike with SQL function), pgvector index already in `supabase/migrations/20260512090000_init.sql`.

**Status:** Pending — add `OPENAI_API_KEY` to env when ready.

---

### 6. Settings → Knowledge editor
**What:** Web UI to edit the knowledge base instead of `pnpm sync:knowledge`. List docs, click in, edit markdown in-place, save → background re-chunks + re-embeds.

**Why deferred:** `sync:knowledge` is faster while Rahul is the only author. Becomes valuable when CSMs without git access start owning content.

**Where:** new route `src/app/(app)/settings/knowledge/...`.

**Status:** **Shipped (v1, 2026-05-12).** `/settings/knowledge` lists core + supplemental docs, `/settings/knowledge/new` and `/settings/knowledge/[id]` create / edit / delete with re-chunking on save. UI-managed docs are written with `source='ui'`; `pnpm sync:knowledge`'s prune filter (`source='manual'`) leaves them alone. Embeddings still NULL — pairs with #5 once an embedding provider is wired up. Chunking helper extracted to `src/lib/knowledge/chunk.ts` and shared with the sync script.

**Follow-up (2026-05-12):** Knowledge load shape switched from eager full-load of core to **manifest + on-demand fetch**, CLAUDE.md-style. System prompt now carries only path+title for every doc (core grouped at top). New tool `mcp__george__read_knowledge_doc(path)` fetches a single doc in full. `search_knowledge` no longer filters out core — it searches the whole KB. `is_core` is now a prominence hint for the manifest, not a content-placement flag.

---

### 7. Mem0 long-term memory integration
**What:** Wire `MEM0_API_KEY` (already in `.env.local`) into George's tool layer — `recall_memory(query)`, `remember(fact, scope?)`. Mirror into `public.memories` for offline analytics. Use scopes per `memory_scope` enum (`short`/`mid`/`long`/`agent`/`customer`/`org`).

**Why deferred:** Need to design what memories are worth keeping vs. re-deriving from DB. Doing this prematurely fills the store with noise.

**Where:** new `src/lib/agent/memory-tools.ts`. Existing `public.memories` table already has `mem0_id` mirror column.

**Status:** Idea — revisit after the inbound-email loop produces enough real signal to motivate it.

---

## UI & ergonomics

### 8. Activity timeline on customer detail
**What:** On `/customers/[id]`, add an "Activity" section that streams the `audit_log` rows scoped to this customer in reverse-chrono order: email drafted/sent, calendar event created, onboarding step completed, transcript fetched, health check recorded.

**Where:** new section on `src/app/(app)/customers/[id]/page.tsx` reading from `public.audit_log` filtered by `customer_id`.

**Status:** Easy win — bump up when there's actual activity to display.

---

### 9. Email thread view per customer
**What:** Section on the customer detail page that lists outbound + inbound emails for that customer. Needs an `email_threads` table (or just rely on `audit_log` payload until volume justifies a dedicated table).

**Status:** Behind #1.

---

### 10. Subagents (Task tool)
**What:** Enable the Claude Agent SDK's `Task` tool / `agents` option so George can spawn parallel subagents for things like "draft three different versions of this kickoff email" or "summarize five transcripts in parallel."

**Why deferred:** One-agent behavior easier to reason about; we should hit a real bottleneck first.

**Where:** `src/app/api/chat/route.ts` `builtinAllow` array (currently `["WebFetch", "WebSearch", "AskUserQuestion"]`).

**Status:** Idea — add when a clear use case appears.

---

## Ops & security

### 11. Rotate the secrets that were pasted in chat history
**What:** Several API keys, the Supabase DB password, and a service-role key were pasted in chat during initial setup. They live in `.env.local` now. Rotate them in their respective dashboards (Supabase, Anthropic, Composio, Mem0) and re-paste fresh values.

**Status:** Do before deploying to a public URL.

---

### 12. Production deploy + webhook URLs
**What:** Deploy to Vercel. Set `NEXT_PUBLIC_APP_URL` to the prod domain. Update Supabase Auth → URL Configuration with the prod URL in Site URL + Redirect URLs. Configure Composio trigger webhook URL.

**Status:** Pending until enough is built that prod testing makes sense.

---

### 13. Disable Supabase self-signup at the platform layer
**What:** Supabase Dashboard → Authentication → Providers → Email → "Allow new users to sign up" → OFF. App already blocks self-signup; this closes the direct-API path.

**Status:** Quick toggle. Do before sharing the URL with anyone.

---

## Settings & identity (near-term)

### 14. Company / organization profile editor
**What:** Admin-only `/settings/organization` page becomes editable. Fields:
- Display name (e.g. "Onyx")
- Customer-facing brand name (could differ from legal name)
- Primary domain (`getonyx.ai`)
- Logo upload (Supabase Storage bucket, square + wordmark variants)
- Tagline / one-line company description (used by George in outbound copy)
- Default timezone + business hours
- Brand color override (defaults to accent if unset)

**Why:** George needs canonical org facts in his system prompt when writing
customer-facing copy. Today the org name comes from `orgs.name` only — the
rest is hard-coded in the AIX Core design system or placeholder copy.

**Where:** `src/app/(app)/settings/organization/page.tsx` (currently a stub).
Likely new tables / columns: extend `orgs` with `display_name`, `tagline`,
`logo_storage_path`, `brand_color`, `default_timezone`, `business_hours`,
`updated_by`. New Supabase Storage bucket `org-assets` with RLS gated by
`is_org_admin`.

**Priority:** Near-term — Rahul flagged for "next few hours/minutes."

**Status:** Shipped 2026-05-12. `/settings/organization` is admin-editable: legal name, display name, customer-facing brand, primary domain, tagline, brand color, default timezone, business hours (start/end + day checkboxes), and square + wordmark logo uploads (PNG/SVG/JPEG/WebP, max 1 MB). Migration `20260515000100_orgs_profile.sql` extended `orgs` with the new columns, added the `trg_orgs_updated_at` trigger, an `orgs_admin_update` RLS policy, and provisioned the public `org-assets` storage bucket with admin-write policies keyed on the `<org_id>/...` path prefix. `src/app/api/chat/route.ts` now fetches the org row and prepends an **Organization profile** block to George's system prompt so he uses these facts in outbound copy.

---

### 15. User profile editor (own profile)
**What:** Everyone-visible `/settings/profile` page becomes editable. Fields:
- First name, last name (currently stored as one `full_name` — split or
  collect both in the form and join)
- Email — read-only (changing email = invite flow)
- Password change (Supabase Auth `updateUser({ password })`)
- Timezone, locale, notification preferences (email digest cadence, mobile
  push when wired)

**Why:** Today invited users land with name from their invite metadata and
can't update it. They also have no way to set a password if they use magic
link only.

**Where:** `src/app/(app)/settings/profile/page.tsx` (currently a stub). Needs
a server action for password update; everything else writes to `org_members`.
Consider promoting `first_name`/`last_name` columns on `org_members` or
keeping `full_name` and parsing on display.

**Priority:** Near-term — Rahul flagged for "next few hours/minutes."

**Status:** Shipped 2026-05-12. `/settings/profile` now edits first/last name (joined into `full_name`), timezone, locale, and password. Migration `20260515000000_org_members_profile.sql` added `timezone`, `locale`, `updated_at` to `org_members` + self-update RLS. Email change still requires admin re-invite (called out in the UI). Notification preferences punted to a future slice.

---

## Proactive behavior + standing jobs **[HLR §9]**

### 16. Standing jobs / scheduler
**What:** George runs scheduled tasks autonomously without a human typing in chat — e.g. every morning pull utilization deltas; every Monday prep this week's cadence decks; hourly scan inbox; on contract intake kick off onboarding end-to-end.

**Why:** This is the **defining v1 capability** per HLR §9. Without it, George is reactive only. Requires: a job-spec table, a runner (Claude Managed Agents in the cloud or a Vercel Cron + spawn pattern), an execution-history table, and rollup reporting to the CSM ("here's what I did overnight").

**Where:** New tables `agent_jobs` (job spec, schedule, owner) and `agent_job_runs` (execution log, outcome, link to created artifacts). Runner likely lives in a separate worker or Claude Managed Agents endpoint.

**Status:** Shipped 2026-05-12. New tables `agent_jobs` (spec + cron + atomic `running_run_id` claim) and `agent_job_runs` (per-execution log) in migration `20260515000200_agent_jobs.sql`. Runner lives in `src/lib/agent/run-job.ts` — shared by both the cron route and the admin "Run now" button so they can't drift. Cron entry point at `/api/cron/run-jobs` (Vercel Cron + `CRON_SECRET` bearer auth, ~240s per-tick budget, deferred-jobs counted in the response). `GEORGE_AUTONOMOUS_RUN_PROMPT` (`src/lib/agent/prompt.ts`) tells George he's in autonomous mode: no `send_email_draft`, no `AskUserQuestion`, finish with a structured Actions/Awaiting review/Notes summary that becomes the run record. `send_email_draft` is also stripped from the tool allowlist in autonomous mode as a belt-and-braces. Admin UI at `/settings/jobs` (create + list + enable/disable + Run now + recent runs). `vercel.json` declares an hourly cron. Schedules use job-level timezone falling back to `orgs.default_timezone` then UTC. Multi-hour work still pending behind #17.

---

### 17. Cloud-managed long-running agents
**What:** Migrate jobs that exceed one chat turn (multi-hour analyses, monitoring loops, bulk parsing) to Claude Managed Agents. Today everything goes through the in-process Agent SDK.

**Why:** Vercel Function timeouts max at 300s; multi-hour work needs an external runner. HLR §5.1 calls this out explicitly.

**Where:** Coordinate with #16. Likely a separate `src/lib/agent/managed/` module that submits and tracks managed agent runs, with results streamed back into `agent_job_runs`.

**Status:** Pending. Blocked by #16 scaffolding.

---

## Document ingestion **[HLR §6.1, §6.2, §10]**

### 18. Contract / NDA / order form parsing
**What:** When sales drops a signed PDF into chat (or forwards it to `george@onyx.ai`), George extracts: customer name, contract term, billing cadence, included scope, Program Manager assignment, pricing. Creates `customers` + `contracts` + `documents` rows.

**Why:** HLR §6.1 calls this the primary intake path. Today George can only create customers from typed input.

**Where:** New `documents` table (per HLR §10) for raw artifact tracking with extracted-fields jsonb. New MCP tool `parse_document(storage_path)` that calls a multimodal model on the PDF. Supabase Storage bucket `customer-docs`.

**Status:** Pending. Practical blocker: needs a working file-upload path in chat (also pending).

---

### 19. File upload in chat
**What:** Drag-and-drop or attach button in the chat input wired to Supabase Storage. Returns a storage path George can read with #18.

**Where:** `src/app/(app)/chat/page.tsx` (input row already has a Paperclip icon — make it real). Server action to issue signed-upload URLs + persist to `documents`.

**Status:** Shipped 2026-05-12. Migration `20260515000700_documents.sql` adds the `documents` table (org-scoped, optional customer/session links, mime/size/path, jsonb `extracted_fields` reserved for #18) + the private `customer-docs` Supabase Storage bucket with org-prefix RLS (members read/write/update, admins delete). `src/app/(app)/chat/upload-actions.ts` exposes `uploadAttachmentAction` (10 MB cap, mime allowlist, sanitised filename, atomic storage→docs row→agent_messages row with `content_json.attachments`, with storage rollback on partial failure) and `getAttachmentDownloadUrl` (short-lived signed URL, org-scoped). `_chat-client.tsx` paperclip button is wired, uses `useTransition` for the upload spinner, surfaces inline upload errors, and renders attachment chips on user messages (mime-aware icon, file size, click → signed-URL download). Chat session page (`[id]/page.tsx`) now pulls `content_json` so server-rendered initial messages include attachments, and accepts `channel='email'` sessions so inbound-event threads open in the same chat UI for review.

---

## Onyx-specific domain model **[HLR §1, §6, §10 — reconciled with knowledge docs]**

### 20. Partner / End Customer hierarchy
**What:** HLR knowledge docs make clear two distinct journeys: **Journey A** (Onyx → Partner / MSP) and **Journey B** (Partner → End Customer). Our `customers` table is currently flat — it assumes one tier. Need to model the hierarchy: `partners` (MSPs Onyx contracts with) vs `end_customers` (the partner's customers).

**Why:** Onboarding flows, user provisioning rules, and approval gates differ between the two. E.g. partner admin can add end-customer users, but partner internal users cannot. Without this distinction, George can't correctly drive Journey B.

**Where:** Either (a) add `customer_kind` enum to `customers` + `parent_customer_id` self-ref, or (b) introduce a separate `end_customers` table. Lean: option (a) — same lifecycle, just labeled differently.

**Status:** Shipped 2026-05-12. Option (a) chosen: `customer_kind` enum (`partner` | `end_customer`) + nullable `parent_customer_id` self-ref on `customers`. CHECK constraint enforces that partners have no parent and end_customers must have one. Migration `20260515000400_customer_hierarchy.sql` backfills existing rows as `partner`. MCP tools: `create_customer` now requires `parent_customer_id` for end_customers and validates the parent is in-org + actually a partner; `list_customers` filters by `customer_kind` or `parent_customer_id`; `get_customer` returns the parent (for end_customers) and the end-customers list (for partners). UI: `/customers` shows Kind + Partner columns; `/customers/[id]` shows a Hierarchy card — either a back-link to the parent partner or the list of end customers, with Add-via-chat shortcut. System prompt updated to spell out the two kinds and require George to confirm + resolve the parent before creating an end_customer.

---

### 21. Onboarding-stage state machine + blocking gates
**What:** HLR knowledge docs §1.5–§1.7 spell out **gates**: Partner Admin must be Active before Internal Users can be onboarded; Internal User onboarding precedes End Customer onboarding. Today `onboarding_steps` are ordered but not gated — George could happily skip ahead.

**Where:** Add `blocks_step_ids uuid[]` on `onboarding_steps`. Update `update_onboarding_step` MCP tool to refuse `status='in_progress'` if any blocker isn't `completed`.

**Status:** Pending.

---

### 22. Onyx-specific concepts: Funding & Co-op, Supplier Onboarding, Pending Request List
**What:** Three Onyx-specific onboarding tasks called out in the CSM knowledge doc that don't exist as first-class entities yet:
- **Funding & Co-op Guide** — partner claims Microsoft co-op funding; needs SOW + status tracking.
- **Supplier Onboarding** — partner sets up Onyx as a supplier on their side; track completion + finance/AP contact handoff.
- **Pending Request List** — partner-side user adds that need manual approval today; planned to auto-accept with 6/12-mo true-up.

**Where:** Could be `onboarding_steps` with a typed `kind` enum (cleaner than free-form titles), or sub-entities like `funding_workflows` and `pending_user_requests`.

**Status:** Pending. Lower priority than #18-#21; comes in when we start scripting Onyx's actual flow.

---

## Cadence, utilization, and reporting **[HLR §2.2–§2.4, §3.1–§3.2]**

### 23. Cadence schedule per customer
**What:** Each partner has an agreed cadence (weekly / biweekly / monthly) for ongoing calls. Today this lives only on calendars. Need a structured `cadence` table: `customer_id`, `frequency`, `day_of_week`, `time`, `last_met_at`, `next_meeting_at`, `channel`.

**Where:** New `cadence` table per HLR §10. George reads from it to remind the CSM of upcoming calls and to drive cadence deck prep.

**Status:** Shipped 2026-05-12. Migration `20260515000500_cadences.sql` adds `cadences` (org-scoped, frequency / channel enums, day_of_week + time_of_day + timezone, duration_min, last_met_at, next_meeting_at, owner_user_id, notes) with a unique-partial-index enforcing one active cadence per customer (old ones get `active=false` rather than deleted, so history is auditable). RLS via `is_org_member`. Three MCP tools — `set_cadence` (supersedes any existing active row), `list_upcoming_cadences` (org-wide window, default 7 days, returns the customer alongside), `mark_cadence_met` (advances `last_met_at`, optionally `next_meeting_at`, appends notes). `get_customer` payload now includes the active cadence. UI: a Cadence section on `/customers/[id]` showing frequency chip, slot text, channel, next/last meeting, and notes — empty state has an "Ask George to set one" CTA. System prompt explains when to use the new tools; the standing-jobs help doc gains an "All-partners cadence prep" example wiring `list_upcoming_cadences` into a daily job.

---

### 24. Utilization data pull from Support Hub
**What:** HLR §2.2: for every cadence call George pulls active users, messages, flags, recalls, period-over-period deltas from the Onyx Support Hub. Replaces the manual collection Indu's team does today.

**Why:** Composio doesn't cover the Onyx Support Hub (it's Onyx's own product). This is a direct integration per HLR §5.4's "build direct when Composio doesn't cover."

**Where:** New `src/lib/integrations/onyx-support-hub.ts` HTTP client + auth flow. Pull jobs scheduled via #16. Store in `health_snapshots` (new table, per HLR §10).

**Status:** Pending. Needs Onyx Support Hub API access details from Rahul.

---

### 25. Cadence deck generator
**What:** HLR §2.4: George auto-generates the partner's PowerPoint deck the night before each cadence call, with utilization numbers, deltas, themes, unresolved flags. Highlights notable changes for the CSM.

**Where:** Likely a server-side renderer (pptx-templater or HTML-to-PDF as MVP). Run as a standing job. Output saved to Supabase Storage; link surfaced in the cadence reminder.

**Status:** Pending. Blocks on #23 and #24.

---

### 26. Out-of-scope / flag triage
**What:** HLR §2.5 + knowledge doc: shared QA mailbox feed + Support Hub Flag Management screen. George categorizes (operational / policy / out-of-domain), suggests responses, tracks SLA, pings on overdue.

**Where:** Needs the same Support Hub integration as #24 (for Flag Management) plus inbox processing on the shared QA mailbox (Composio Outlook on a *different* connected account).

**Status:** Pending. Significant scope; defer until cadence/utilization are working.

---

### 27. 30 / 60 / 90 Success Sprint check-ins
**What:** HLR §3.1: structured check-in agenda + data pack at 30/60/90 days post-start-date. Compare actual ramp vs expected; flag below-threshold accounts.

**Where:** Standing job per #16, gated by `customers.start_date`. Generates a structured report + draft email.

**Status:** Pending. Behind #16 + #24.

---

## Memory layers **[HLR §5.8]**

### 28. Wire mem0 for long-term memory
**What:** Use `MEM0_API_KEY` (already in env). New MCP tools: `recall(query)`, `remember(fact, scope?)`. Long-term + agent-level memories go to mem0; short/mid-term stay in our `memories` table.

**Why:** HLR §5.8 makes mem0 the primary long-term store. Currently nothing reads/writes memory.

**Where:** New `src/lib/agent/memory-tools.ts`. Existing `memories.mem0_id` column mirrors mem0 ids for cross-reference.

**Status:** Pending. This was already item #7 — keeping that ID for continuity; reading this entry should redirect to #7.

---

### 29. Session-scoped memory injection
**What:** At each new chat session start, fetch relevant recent memories for the customer in focus (or top-N portfolio facts) and prepend to the system prompt. Reduces "George forgot what we discussed yesterday" friction.

**Where:** `src/app/api/chat/route.ts` — extend the system-prompt builder that already injects the knowledge-doc list.

**Status:** Pending. Behind #28.

---

## Voice surface **[HLR §1, §13]**

### 30. Voice transport for the chat surface
**What:** HLR §1 says chat *and voice*. HLR §13 flags this as an open question: browser-native (Web Speech API) vs a streaming TTS/STT service (Deepgram, Cartesia, etc.). Today the chat UI has a Mic icon placeholder only.

**Where:** `src/app/(app)/chat/page.tsx` mic button + a new transport layer. Decision needed before building.

**Status:** Pending — open question. Defer until text path is solid.

---

## Open questions from HLR §13 (decisions to make)

These aren't todos in the build sense — they're decisions we owe ourselves before certain features can ship.

- **KB storage strategy.** Default chosen: markdown source + Supabase pgvector. Confirm with embedding provider when #5 lands.
- **Voice transport.** See #30.
- **Authorization model granularity.** Today: org-level + 5 role types. Need to decide if per-customer or per-action permissions are needed in v1. Lean: not in v1.
- **Composio coverage depth for M365.** Confirmed for mail send/reply + calendar CRUD; free/busy not yet tested. Verify before #25.
- **Fireflies via Composio.** Listed in their toolkit. Confirm transcript fetch + webhook works end-to-end (backlog #2 will surface this).
- **Approval boundary per action.** Today: prompt forces draft-confirm-send on email. Calendar events go through directly. Need a written policy of which actions require explicit human confirmation; #3 covers email side.
- **Tenancy model.** Onyx is the first tenant. Schema is already multi-tenant (`org_id` everywhere + RLS). Question is when to onboard a second org and whether bootstrap-owner rules need to change. Lean: do nothing until tenant #2 is real.

---

## How to use this file

- Add new items when we defer something. Always say *why deferred* — that's the most decay-resistant detail.
- Promote an item to "in progress" by mentioning it in chat; we'll knock it out and delete the entry.
- Kill an item by replacing its **Status** with `Killed: <reason>` rather than removing the entry — keeps the decision trail.
