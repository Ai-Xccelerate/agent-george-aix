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

**Vercel primitive:** Fluid Compute Function for the webhook (returns 200 fast). `after()` for kicking off `processAgentEvent()`. If any single reply needs to run > 5 min (e.g., transcript-based deep analysis), migrate that path to a `"use workflow"` function — see `docs/01-vercel-deployment.md`.

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
**What:** Replace JS-side multi-word ilike scoring with proper vector similarity. Populate `knowledge_chunks.embedding` (1536-dim) at sync time using OpenAI `text-embedding-3-small`. Swap `search_knowledge` to a SQL function that does `embedding <=> query_embedding` cosine distance.

**Why deferred:** Needed an embedding-provider API key.

**Where:** `scripts/sync-knowledge.ts` (populate embedding), `src/lib/agent/tools.ts` `searchKnowledge` (replace ilike with SQL function), pgvector index already in `supabase/migrations/20260512090000_init.sql`.

**Status:** Shipped 2026-05-12. `OPENAI_API_KEY` provisioned. New helper `src/lib/knowledge/embeddings.ts` exposes `embedText` / `embedBatch` / `hasEmbeddingProvider` (text-embedding-3-small, 1536-dim, batched ≤128). `pnpm sync:knowledge` now embeds new chunks on insert and runs a backfill pass over any pre-existing NULL embeddings (43 chunks embedded on first run). Settings → Knowledge editor (`src/app/(app)/settings/knowledge/actions.ts`) also embeds on save so UI-created docs are immediately searchable. Migration `20260515000800_knowledge_vector_search.sql` adds `match_knowledge_chunks(p_org_id, p_query, p_limit)` — a `SECURITY DEFINER` SQL function that does the cosine-distance lookup and joins the parent doc. `search_knowledge` now embeds the query, calls the RPC, and reports `mode: "vector"`. If the OpenAI call fails or the key is unset, it transparently falls back to ilike (`mode: "ilike"`) so the tool never hard-fails mid-conversation.

**Hybrid RAG policy (Option A, locked in 2026-05-12):** Core docs (`knowledge_docs.is_core=true`) are intentionally excluded from vector search. They carry George's role / scope / lifecycle / process / rules where chunked snippets would be lossy. Two retrieval contracts:
- **Core** → fetch whole via `read_knowledge_doc(path)` only. Verbatim, no chunking.
- **Supplemental** → vector-search via `search_knowledge(query)`; can still be fetched whole with `read_knowledge_doc(path)` for full context.

Enforcement is server-side: migration `20260515000900_knowledge_vector_search_skip_core.sql` adds `and d.is_core = false` to `match_knowledge_chunks`; the ilike fallback applies `eq("knowledge_docs.is_core", false)` for parity. System prompt manifest (`src/lib/agent/system-prompt.ts`) groups core docs first under "fetch whole via `read_knowledge_doc(path)`" and supplemental under "searchable via `search_knowledge(query)`", and spells out: "If you're unsure whether a question is core or supplemental, treat it as core." Tool descriptions for both `search_knowledge` and `read_knowledge_doc` carry the same contract so the agent sees it from either entry point.

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

**Vercel primitive:** **Don't enable the SDK's `Task` tool on the chat path.** Sub-agents that need to run > 5 min or in parallel belong in **Vercel Workflow** with `DurableAgent` from `@workflow/ai`. Parent workflow fans out via `start()` wrapped in a step (see `docs/01-vercel-deployment.md` for the sketch).

**Status:** Idea — add when a clear use case appears.

---

## Ops & security

### 11. Rotate the secrets that were pasted in chat history
**What:** Several API keys, the Supabase DB password, and a service-role key were pasted in chat during initial setup. They live in `.env.local` now. Rotate them in their respective dashboards (Supabase, Anthropic, Composio, Mem0) and re-paste fresh values.

**Status:** Do before deploying to a public URL.

---

### 12. Production deploy + webhook URLs
**What:** Already deployed on **Railway** (project *Agent George - Onyx*, service `george-onyx`, Docker build from `rvbhavsar/george-onyx`). Remaining: set `NEXT_PUBLIC_APP_URL` to the prod domain. Update Supabase Auth → URL Configuration with the prod URL in Site URL + Redirect URLs. Configure Composio trigger webhook URL. Wire a scheduler for `/api/cron/run-jobs` (see #43 — there's no cron on Railway; the inert `vercel.json` cron was removed).

**Host note:** Railway runs a persistent `next start` server — no 300s ceiling, no Vercel Cron. The Vercel-primitive mapping in `docs/01-vercel-deployment.md` is **superseded**; ignore it for the live host.

**Status:** Live on Railway; cron trigger + prod URL/webhook config still pending.

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

**Status:** Shipped 2026-05-12. New tables `agent_jobs` (spec + cron + atomic `running_run_id` claim) and `agent_job_runs` (per-execution log) in migration `20260515000200_agent_jobs.sql`. Runner lives in `src/lib/agent/run-job.ts` — shared by both the cron route and the admin "Run now" button so they can't drift. Cron entry point at `/api/cron/run-jobs` (Vercel Cron + `CRON_SECRET` bearer auth, ~240s per-tick budget, deferred-jobs counted in the response). `GEORGE_AUTONOMOUS_RUN_PROMPT` (`src/lib/agent/prompt.ts`) tells George he's in autonomous mode: no `send_email_draft`, no `AskUserQuestion`, finish with a structured Actions/Awaiting review/Notes summary that becomes the run record. `send_email_draft` is also stripped from the tool allowlist in autonomous mode as a belt-and-braces. Admin UI at `/settings/jobs` (create + list + enable/disable + Run now + recent runs). Schedules use job-level timezone falling back to `orgs.default_timezone` then UTC. Multi-hour work still pending behind #17.

**⚠️ Production gap (found 2026-06-24):** the schedule does not fire in prod. It previously relied on a `vercel.json` cron, but we deploy on **Railway**, where Vercel Cron does not exist — so that cron was inert (confirmed dark in HTTP logs) and has been **removed** to stop implying a working schedule. No Railway cron service / external pinger hits `/api/cron/run-jobs` yet. **To fix:** add a Railway cron service (a second service that `curl`s the endpoint with the `CRON_SECRET` bearer hourly) or an external scheduler. Until then, standing jobs only run via manual "Run now".

---

### 17. Cloud-managed long-running agents
**What:** Migrate jobs that exceed one chat turn (multi-hour analyses, monitoring loops, bulk parsing) to a long-running runtime. Today everything goes through the in-process Agent SDK with a 240s budget.

**Why:** Vercel Function timeouts max at 300s; multi-hour work needs a durable runtime. HLR §5.1 calls this out explicitly.

**Where:** Coordinate with #16. New module `src/lib/agent/workflows/` containing `"use workflow"` functions. `run-job.ts` keeps handling the short-bounded path; long-job route uses Workflow + `DurableAgent`.

**Vercel primitive:** **Vercel Workflow DevKit** (`workflow` + `@workflow/ai` + `@workflow/next`). `"use workflow"` orchestration + `"use step"` units. `DurableAgent` from `@workflow/ai` for the agent loop — same shape as Anthropic's Managed Agents but Vercel-side with full access to our MCP tools and DB. The two are complementary: Workflow for tightly-integrated work, Anthropic Managed Agents for compute-heavy work we don't want occupying our runtime (a Vercel Workflow can submit a Managed Agent job and `createHook()` on completion). Full migration sketch in `docs/01-vercel-deployment.md`.

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

## Microsoft Teams surface

### 31. Agent George as a Microsoft Teams bot (for the Onyx team)
**What:** Expose George as a bot inside the Onyx team's Microsoft Teams so members chat with him 1:1, @mention him in group chats, and @mention him in meeting chats — all text. George reuses the existing `query()` pipeline, prompt, and tools; Teams is just a new inbound surface alongside `/api/chat`. This is an integration project, not a rebuild.

**Meeting-scope fork (decide first — order-of-magnitude difference):**
- **A. Text-in-meeting-chat (intended path):** George replies in the meeting's text chat when @mentioned — same mechanism as group chat. Small build. Scribe already covers transcripts/recall, so George does not need to "hear" the call.
- **B. Live media meeting bot:** joins the call, processes real-time audio. Requires Calls/Online Meetings media API, tenant RSC consent, separate media-capable host. Large separate project — explicitly out of scope unless revisited.

**Architecture:** Teams → Azure Bot Service → new `POST /api/messages` on `cs.getonyx.ai` → tenant gate → resolve user → existing George pipeline → reply (with typing indicator while it works; ack fast, don't block).

**Build (in-repo, mine):**
- `src/app/api/messages/route.ts` — Bot Framework messaging endpoint via the `botbuilder` npm package (`CloudAdapter`). Chosen over the newer M365 Agents SDK: mature, Node-native, drops into the existing server; matches "don't introduce alternative stacks." M365 Agents SDK noted as the forward migration, not today's path.
- Tenant gate: reject anything where `activity.conversation.tenantId !== <Onyx tenant id>` — that *is* the allowlist on this surface, stronger than email-domain parsing. Note: the activity payload does NOT reliably include email/UPN — fetch via `TeamsInfo.getMember()` / Graph only when mapping to a contact. No Supabase auth session on this path — runs service-role, org-scoped by tenant (like the webhook path).
- Teams app manifest (`manifest.json` + 2 icons, zipped): `"bots"` with scopes `["personal","groupChat","team"]`. In group/meeting chats George only receives @mentions (by design); in personal scope he sees all DMs.

**Provision (Azure, AIXccelerate tenant — not in-repo):**
- Entra app registration → App ID + secret (recommend multi-tenant so Onyx users can reach it; restrict to Onyx in code via tenantId).
- Azure Bot resource, Teams channel enabled, messaging endpoint = `https://cs.getonyx.ai/api/messages`. App ID/secret go into Railway env.

**Distribute to Onyx (their Teams admin, not us):** hand them the `.zip` → Teams Admin Center → Manage apps → Upload new app → Submit to your org (org catalog, not public store). Optionally pin via a setup policy. No Microsoft Partner Center / AppSource submission — that's only for public multi-org distribution.

**Where:** new `src/app/api/messages/route.ts`; reuses `src/lib/agent/{prompt,tools,composio-tools}.ts`; new `teams/` manifest folder.

**Status:** Backlogged 2026-06-29 (deferred by Rahul — focus on Composio first); **picked back up and built 2026-07-03.** In-repo build is done: `src/app/api/messages/route.ts` (tenant gate → typing ack → `agent_events` persist → `after()` dispatch), `src/lib/teams/{adapter,process-event,tenant-gate}.ts` (CloudAdapter via `processActivityDirect`/`continueConversationAsync` — no req/res shim needed, see adapter.ts comments), `teams/manifest.json` + placeholder icons. Went with meeting-scope fork A (text-in-meeting-chat via @mention) per the original plan; B remains out of scope. Blocked on the Azure provisioning steps below (Entra app registration, Azure Bot resource, Railway env vars) — those are Rahul's to do outside this repo before it can be tested end-to-end.

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

## Program-management capability roadmap **[KB 2026-05-19]**

Surfaced by the post-Seattle KB refresh (`core/02-agent-george-role.md`, `core/03-agent-george-lifecycle-steps.md`). The single operating objective is to move program-management capacity from **5–10 partners per PM → 25 → 50**. Every item below is scored against (a) does it move the capacity number and (b) does it take a task out of Mode A into Mode B with a real, measurable gate.

### 50. Pre-call briefing engine (Mode A → B)
**What:** On-demand "one-screen brief" per partner: profile, recent assessments, deals in flight, open support questions, last coach touch, suggested agenda. Ready before the PM sits down.

**Why deferred:** Need to consolidate partner timeline first (assessment activity is not modelled yet — see #51). Today the only inputs we hold are agent_sessions, agent_jobs, contacts, contracts.

**Gate to Mode B:** PM has used the brief format for 4+ partners and confirms it matches what they would have produced.

**Where:** New surface — likely a `/partners/[id]/brief` view backed by a knowledge-routed agent run, or an inline chat tool `prepare_partner_brief(partner_id)`.

**Status:** Idea.

---

### 51. Tenant-ingest watcher (Mode B)
**What:** Watch every Transition Hub tenant ingest. Confirm start, confirm completion, classify failures (CSP readiness quota issues, parsed-contract pricing-tier issues, Partner Center API outage), trigger reruns on known-good remediation patterns, escalate logic failures to Esteban + the PM.

**Why deferred:** No integration to Transition Hub job-state today. Onyx platform is still being moved to Azure; the job-watch surface isn't defined.

**Gate to Mode B:** one full month of clean classification with zero PM corrections on failure category.

**Where:** Needs a Transition Hub events feed (webhook or polled). Likely a new `tenant_ingests` table + an autonomous-job runner sweeping it.

**Status:** Pending — depends on Transition Hub platform consolidation on Azure.

---

### 52. Persona-tailored scenario drafting
**What:** Same assessment data, four rendered views: partner AM view (deal-leading language), partner SE view (24-workload depth), customer CFO view (As-Is / Right-Size / Optimize commercial), customer CIO view (security score, AI readiness, competitive-takeout). George drafts; partner sends.

**Why deferred:** Need the assessment data shape from Transition Hub first.

**Where:** Likely a new agent tool `render_scenario(assessment_id, persona)` and a knowledge-doc set per persona template.

**Status:** Idea.

---

### 53. Partner-outbound drafting in partner brand
**What:** Drafted in the partner's voice, on the partner's brand, for the PM (or the partner) to review and send. Includes the customer-side Entra ID authorization email and the in-cycle partner-to-customer status update.

**Why deferred:** Partner brand assets and voice notes aren't captured yet. Today every partner-facing artifact would carry Onyx defaults.

**Where:** New `partner_brand` fields on `customers` (logo, primary color, sender name, voice notes), wired into draft_email so the drafted body matches.

**Status:** Idea. Brand-asset capture is a prerequisite.

---

### 54. Licensing-question router with confidence-scored answers
**What:** Take a partner's licensing question (any surface — chat, email, Teams agent, Copilot, shared inbox). Query Support Hub's curated KB with confidence. For high-confidence: draft, then in Mode B send directly. For low-confidence: route to the human-in-the-loop and name who's picking it up and when.

**Why deferred:** Support Hub KB is a separate system (ChromaDB, Cohere search, LangSmith tracing); not yet integrated. The HITL workflow isn't wired either.

**Gate to Mode B:** PM has reviewed 50+ George-drafted licensing answers and the override rate is below an agreed threshold (number TBD).

**Where:** A new `search_support_hub` MCP tool + a routing table for surfaces.

**Status:** Pending — needs Support Hub API surface.

---

### 55. Multi-surface delivery for Support Hub answers
**What:** Render the same answer into Microsoft Teams (agent in marketplace), Copilot, shared inbox, and plain email — meeting partners where they already are. "Take this to where the users live" is the explicit direction.

**Why deferred:** Today Support Hub is web-only. Teams agent is on Onyx's roadmap; Copilot agent is downstream of that. No work on the George side until the upstream surfaces exist.

**Status:** Pending — blocked on Onyx product side.

---

### 56. Partner-health scoring across the PM's book
**What:** Weekly health pull per partner: assessments run, deals in motion, deals at risk, support volume, response latency, days to renewal. Risk classification (on-track / watch / at-risk) with the specific signal cited.

**Why deferred:** Need Transition Hub assessment counts and Support Hub interaction logs. Schema for `customer_health` exists; the inputs do not.

**Gate to Mode B for monitoring:** day-one. Outreach drafting stays in Mode A.

**Where:** Extend `customer_health` with the multi-signal inputs; build a scheduled job that writes weekly snapshots; surface in `/dashboard` and in the daily digest.

**Status:** Idea.

---

### 57. Renewal clock — T-90 / T-60 / T-30
**What:** Track contract end dates. At T-90 surface to PM with usage data. At T-60 draft renewal-conversation talking points (Mode A). At T-30 escalate if no PM-led conversation has happened.

**Why deferred:** Contract end-date capture is in `contracts` but not validated. No scheduled sweep yet.

**Where:** Standing job + a `renewal_alerts` table or a typed `agent_events`.

**Status:** Idea.

---

### 58. Coaching knowledge capture (Mode B)
**What:** Capture every coached session — transcript, decisions, what the PM said, what the partner asked. Structure into a program-management knowledge layer (question, situation, PM framing, recommended approach). Surface relevant prior coaching when a new partner hits the same question. This is how the second partner is faster than the first.

**Why deferred:** Today Fireflies transcripts come in raw and aren't being structured. The "PM knowledge layer" is a new concept — separate from the partner-facing Support Hub KB.

**Where:** New `coaching_notes` table; subagent that ingests transcripts and writes structured Q&A; hooked into `search_knowledge` with a separate scope.

**Status:** Idea.

---

### 59. Mode A / Mode B governance
**What:** Per-task confidence tracking, PM-approved Mode B transitions per task type per partner, audit trail of every mode-change decision. George does not graduate himself — the PM moves him.

**Why deferred:** No "mode state" anywhere in the schema yet. Need to model task-type × partner × mode + override-rate tracking before the governance UI makes sense.

**Where:** New `agent_mode_grants` table; UI in `/settings/jobs` or a new `/partners/[id]/agent` tab.

**Status:** Idea. Foundational for #54, #55, #56.

---

### 60. PM daily / weekly / monthly digests
**What:**
- **Daily (one screen):** drafts pending review, decisions needed, new risk flags across the PM's book.
- **Weekly:** per-partner health summary + capacity-against-target line.
- **Monthly capacity report (PM-lead facing):** actual partners-per-PM in flight vs target (5 → 25 → 50).

**Why deferred:** Depends on #56 and #59 being real.

**Where:** Standing jobs + a `/dashboard` redesign. Today's dashboard is generic; the PM-lead view is the one Fraser would actually open.

**Status:** Idea.

---

### 61. Branded live-link assessment output (replaces PDF)
**What:** Replace today's PDF export of Transition Hub scenarios with a branded live link that the partner can share with their customer. PowerPoint is the partner-requested fallback. This is a partner ask coming out of the Seattle workshop.

**Why deferred:** Lives in Transition Hub, not in George — but George needs to know what surface the link comes from so he drafts the right partner-to-customer email body.

**Status:** Pending — Onyx-side platform work. Track for awareness.

---

### 62. Maya ↔ George handover
**What:** Define behavior at moments where both Maya (in-app, partner-facing) and George (outside the app, PM-facing) could engage the same partner. Default today: George does not engage the partner's customer directly; the partner owns that relationship. Maya direction (multimodal, multilingual) may shift this.

**Why deferred:** Maya is a thin entry point today; the multimodal version is roadmap. Premature to design the handover until Maya's surface is real.

**Status:** Open question — captured in `core/02-agent-george-role.md`.

---

### 63. PM-lead capacity dashboard
**What:** John / Chris / Neil / Fraser want a view that answers "how close are we to PM 2.0?" — actual partners-per-PM in flight, target, gap, where George is bottlenecked. Different audience from #60 (which is per-PM).

**Why deferred:** Same dependencies as #60.

**Status:** Idea.

---

### 64. Outlook-side category labels per customer
**What:** When inbound mail to `agent.george@getonyx.ai` is auto-linked to a customer in our DB, also stamp an Outlook category on the message itself (e.g. `Customer: Helix Cloud`). One category color per partner, deterministic from name. Likely needs `OUTLOOK_UPDATE_MESSAGE` or an equivalent Graph categories endpoint via Composio.

**Why deferred:** Need to verify the Composio action slug + payload shape and seed the org's master Outlook category list (Graph requires categories be defined per-mailbox before they can be applied). App-side labels in `/actions` are already shipped — Outlook-side is the polish layer.

**Where:** `src/lib/agent/process-event.ts` after `resolveSenderToCustomer`. Plus a one-time category-bootstrap routine.

**Status:** Idea.

---

### 65. Approve/edit/dismiss controls inline on /actions
**What:** Each draft row on `/actions` today opens the floating chat for review. Add inline buttons: **Send** (calls `send_email_draft` server action), **Edit** (opens the bubble with the draft preloaded for revision), **Discard** (deletes the Outlook draft + the audit row). Keep the open-in-bubble flow as the fallback for nuanced cases.

**Why deferred:** Send-without-bubble bypasses the human-in-the-loop framing the prompt has been built around — needs a deliberate decision on whether to allow direct send from the actions list or require the bubble round-trip. Worth shipping after a week of using the bubble flow.

**Where:** New server actions in `src/app/(app)/actions/actions.ts`; row component in `_open-in-bubble.tsx` grows into a control cluster.

**Status:** Idea.

---

### 67. Sanitized HTML rendering in /actions detail pane
**What:** The right column on `/actions` today shows the email body and George's draft as stripped plain text. Real Outlook mail uses bullets, links, inline emphasis — rendering as text loses signal. Render sanitized HTML (DOMPurify or rehype-sanitize) instead, with a strict allowlist (no `<script>`, no inline event handlers, no remote images that could beacon).

**Why deferred:** Inbound mail comes from the wild internet — rendering it raw is an XSS surface. Needs a vetted sanitizer, a deliberate allowlist, and a "load remote images?" toggle for tracking-pixel hygiene.

**Where:** `src/app/(app)/actions/page.tsx` DetailPane → InboundBody / DraftBody.

**Status:** Idea.

---

### 66. Risk flags as a first-class surface
**What:** George already names risks in his summaries; promote those into structured records (`agent_events` of type `risk_flag` or a `risks` table) so the AI actions page can show a "Flagged risks" section alongside drafts and inbound. Each risk: customer, severity, signal, recommended next step, status (open / acknowledged / resolved).

**Why deferred:** No structured risk model today. Today George's risk language only exists inside autonomous-run summary text — readable but not queryable.

**Where:** A new tool `flag_risk(customer_id, severity, signal, suggested_action)` for George to call; new section in `/actions`.

**Status:** Idea. Pairs naturally with #56 (partner-health scoring).

---

### 69. Duplicate owner row in `org_members`
**What:** Org `00000000-0000-0000-0000-000000000001` (AIX) lists `manasa@aixccelerate.com` twice, both as `owner`. Decide whether `(org_id, email)` or `(org_id, user_id)` is the uniqueness key, de-duplicate, and add the constraint.

**Why it matters:** Harmless to read, but it double-counts. Anything that iterates members — seat counting, "notify the owner", digest recipients, a future per-member rate limit — does it twice for this person. The failure is quiet: it surfaces as somebody getting two of something.

Worth deciding the key deliberately rather than just deleting a row. The two entries may be one human with two Clerk user_ids (a personal login and an org login), in which case the duplicate is a symptom of identity mirroring and deleting one row lets it come back on the next JIT mirror.

**Where:** `org_members`. The JIT mirror in `src/lib/supabase/current-user.ts` writes these rows. Needs a migration for the constraint.

**Why deferred:** Found while auditing the two malformed org rows on 2026-08-27 (both since fixed — one was a live send-authority bug). Not blocking Feature 1: nothing in the onboarding path fans out over members. Cleaning it properly means understanding the mirror, not just deleting a row.

**Status:** Logged 2026-08-27 (Vidhi).

---

---

### 70. The AIX template port was a recolour, not a rebuild
**What:** Commit `e32006b` ("UI: rebuild George's front end on the AIX UI template") added the template's components wholesale and then, for most existing screens, swapped colour tokens line-for-line and left the layout alone. Those pages look like the template and are not built on it. Audit them and rebuild the layouts that need it — starting with the ones a customer or an exec actually sees.

**How to tell which:** the port's own diff. A file with **equal insertions and deletions** was a 1:1 line swap — `var(--color-*)` to scale classes, `text-[13px]` to `text-theme-sm` — with no structural change:

```
git show --numstat e32006b -- 'src/app/**' | awk '$1==$2 {print}'
```

**55 files** come back equal. Eight were genuinely reworked (`_shell.tsx`, `dashboard/page.tsx` at 234/39, `_partners-view.tsx`, `_activity-stats.tsx`, `mailbox/[id]`, `settings/knowledge`, both `transcripts` pages); everything else is inherited layout under new colours.

**Why it matters:** the layouts predate the design system, so they were never held to its constraints. `/customers/[id]` (82/82, the largest recolour) shipped a left region built with CSS multi-column masonry — which balances height beautifully and **cannot express a minimum width**. Beside a 400px rail it produced ~200px tracks, and cards wrapped to one or two words per line. Nobody saw it until an account page was opened with real content in it, because the fault only appears at certain widths with certain amounts of text.

That is the shape of the whole category: not broken, just never designed against the grid it now wears, and failing at sizes nobody happened to open.

**Where to look first.** Signals across the recoloured set today:

- `justify-between` next to `shrink-0` — **17 files**. This is the exact bug in `EmptyRow`: an unshrinkable action beside text with no floor, so the text collapses and the button keeps its width.
- Hardcoded pixel widths in layout (`w-[NNNpx]`, `min-w-[NNNpx]`) — **31 occurrences**. Fine in a fixed rail, wrong inside a flexible track.
- Grid tracks of `minmax(0,1fr)` with no floor — now **1** (the remaining one is deliberate).

The masonry idiom (`columns-*`, `break-inside-avoid`) is gone: `/customers/[id]` was the only user and it was fixed on 2026-09-02.

**Why deferred:** found while fixing `/customers/[id]` for the Feature 1 demo. Fixing 55 screens speculatively is worse than fixing the ones that are actually wrong — most will be fine, since most are simple stacks. This is an audit with a cheap detector, not a rewrite.

**Status:** Logged 2026-09-02 (Vidhi). Do it per-screen as each is next touched, or in one pass before anything customer-facing ships.

---

## How to use this file

- Add new items when we defer something. Always say *why deferred* — that's the most decay-resistant detail.
- Promote an item to "in progress" by mentioning it in chat; we'll knock it out and delete the entry.
- Kill an item by replacing its **Status** with `Killed: <reason>` rather than removing the entry — keeps the decision trail.
