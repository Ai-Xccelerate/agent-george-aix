# Agent George — V2 Evolve Plan

**Evolve-track against the live V1 codebase. Supersedes the from-scratch "V2 rebuild" spec.**
Last updated: 2026-06-24.

---

## Why this doc exists

A "V2" spec was drafted proposing a from-scratch rebuild (Express + LangGraph.js + BullMQ + PM2, hand-rolled auth, AgentMail, direct MS Graph, drop Supabase). After analyzing the V1 codebase against it, the conclusion was: **V1 is built well and nothing is broken.** What actually changed is not the architecture — it's three things:

1. **Scope got simpler.** The original onboarding model (the ~27 prescribed lifecycle steps in `knowledge/core/03-agent-george-lifecycle-steps.md`) is no longer how Onyx works. It needs to be fluid, not a checklist.
2. **It feels "not agentic enough."** Root cause is the rigid step scaffold + the CRUD UI built to mirror it — George marches a checklist instead of reasoning. The fix is **less scaffolding, not more orchestration.**
3. **The trigger model should flip** from manual UI to event-driven (inbound email + Zoho CRM lead/order), with Scribe listening to meetings.

None of this requires a rebuild. Every change below is **additive or subtractive on the existing V1 foundation.** We keep Next.js 16, the Claude Agent SDK, Supabase (Auth/RLS/Storage/pgvector), Composio, and Railway.

---

## Core architecture decision: macro/micro split (NOT LangGraph)

George's reasoning stays a **pure Claude Agent SDK loop** — fluid, no hardcoded graph. We do **not** adopt LangGraph: a node graph re-imposes exactly the rigidity we're removing from the lifecycle steps, and would make George feel *less* agentic, not more.

The one real gap in a pure-SDK approach is **durable, time-spanning orchestration** (follow up in 48h, wait for a signature, survive a restart, run a 3-week kickoff arc). We solve that with a thin deterministic layer *around* the agent, not inside it:

```
DETERMINISTIC MACRO LAYER  — decides WHEN to wake George + WITH WHAT context
  • event router    (email in / Zoho lead / Scribe transcript ready → enqueue)
  • durable queue   (retries, DLQ, survive restarts)        ← the one real eng add
  • timers/scheduler(“48h elapsed, no reply → wake George on this thread”)
        │
        ▼
AGENTIC MICRO LAYER  — decides WHAT to do
  • Claude Agent SDK + the (now simplified) playbook
  • fluid: no fixed node graph; George picks the next right move
```

V1 already has the bones of the macro layer (`agent_events`, `agent_jobs`, `process-event.ts`, `run-autonomous.ts`, `/api/cron/run-jobs`). They are under-built — we harden them, we don't replace them.

### What we are explicitly NOT doing

| Rejected from the rebuild spec | Why |
|---|---|
| LangGraph.js node graph | Re-creates the step rigidity we're deleting. Agent SDK already orchestrates fluidly. |
| Express rewrite | Next.js 16 route handlers already serve every surface. |
| PM2 cluster mode | Solves a problem Railway + Next don't have. Circular justification. |
| Drop Supabase, hand-roll auth | Throws away working Auth + RLS + Storage + pgvector RAG. Most regressive line in the spec. |
| AgentMail | Redundant second email channel. Standardizing on Composio M365 (see Phase 1). |
| Direct MS Graph for calendar | Pure transport swap; Composio already abstracts it and dodges Azure AD token renewal. |

The **one** thing worth importing from the rebuild spec: a **durable queue (BullMQ + Redis)** for the macro layer (Phase 3).

---

## Map to the rebuild spec's four phases

| Rebuild spec phase | This plan |
|---|---|
| Phase 1 — Foundation | Already done in V1. Don't rebuild. |
| Phase 2 — Intelligence | Already done in V1 (Agent SDK, classification, kickoff). Phase 0 here *simplifies* it. |
| Phase 3 — Action | Mostly done. Phase 2 here adds event-driven triggers + Zoho + Scribe. |
| Phase 4 — Scale & Resilience | Phase 3 here (durable macro layer) + Phase 4 (observability). |

---

## Phase 0 — Strip the scaffold (the unlock)

> Make George fluid. Cheapest change, biggest "feels agentic" win. No schema change.
>
> **Status: ✅ done 2026-06-24.** `03` rewritten to a fluid operating model; `01` reframed as descriptive context; `prompt.ts` softened ("not a checklist — generate a short plan and adapt"); knowledge synced to Supabase; UI surgery found unnecessary (data-driven) and deferred to Phase 4. *Open: business-substance review of possibly-stale Onyx facts (names, Arrow pilot, May workshop) in `01`/`03`.*

**Outcome:** George reasons from a goal + playbook instead of marching prescribed steps. The lifecycle becomes 3–5 fluid milestones George generates per partner, not a fixed checklist.

| Area | Deliverable | Files / tables |
|---|---|---|
| Lifecycle content | Rewrite the lifecycle doc: keep the *goals, focus principles, Mode A/B split, exit criteria*; delete the prescribed step-by-step tables. State outcomes, not sequences. | `knowledge/core/03-agent-george-lifecycle-steps.md` (then `pnpm sync:knowledge`) |
| Onboarding playbook | Trim the onboarding process doc to principles + what "good" looks like, not an ordered procedure. | `knowledge/core/01-csm-onboarding-process.md` |
| Prompt softening | Change framing from "follow these steps" to "here's the goal and your playbook — decide the next right move. Generate a short milestone plan per partner; adapt it." | `src/lib/agent/prompt.ts` (`GEORGE_SYSTEM_PROMPT`), `src/lib/agent/system-prompt.ts` |
| UI | **No change needed (verified 2026-06-24).** The onboarding step UI is 100% data-driven (`page.tsx` renders `onboarding_steps` from the DB; `create_onboarding_plan` numbers whatever George passes). With fluid milestones it just renders fewer rows — nothing rigid to remove. The real UI inversion (chat + actions as the center) is **moved to Phase 4.** | — |
| Keep | `onboarding_plans` / `onboarding_steps` schema — now holds whatever George generates. The `create_onboarding_plan` tool already accepts a free-form steps array. | no migration |

**Phase 0 done when:**
- The core knowledge no longer prescribes a fixed step sequence.
- George, given a new partner, generates a short fluid milestone plan and explains his reasoning — not a 27-row checklist.
- The customer detail page no longer presents onboarding as a rigid checklist.

---

## Phase 1 — Consolidate email + calendar on Composio M365

> Simplify by deletion. One email identity, one inbound webhook spine. Drop AgentMail.
>
> **Status: ✅ done 2026-06-24.** Deleted the agentmail route, client, register script, and the `processAgentmailEvent` branch in `process-event.ts` (kept the shared `resolveSenderToCustomer`). Dropped `agentmail` + `svix` from `package.json` (svix was agentmail-only). Clean `pnpm build` green; `/api/webhooks/agentmail` now 404s, Composio spine (`/api/webhooks/composio`) intact. *Open: remove `AGENTMAIL_*` vars from `.env.local` + Railway (live secrets — left for you).*

**Outcome:** Composio/M365 Outlook is the single, unambiguous path for inbound email, outbound email, and calendar. AgentMail is removed.

| Area | Deliverable | Files / env |
|---|---|---|
| Disable AgentMail | Remove the AgentMail inbound path and dependency. Confirm no inbound relies on it. | delete `src/app/api/webhooks/agentmail/route.ts`, `src/lib/agentmail/client.ts`, `scripts/register-agentmail-webhook.ts`, `processAgentmailEvent` in `src/lib/agent/process-event.ts`; drop `agentmail` from `package.json`; retire `AGENTMAIL_*` env vars |
| Single inbound spine | Confirm Composio `OUTLOOK_MESSAGE_TRIGGER` is the only inbound trigger; verify registration. | `src/app/api/webhooks/composio/route.ts`, `scripts/register-outlook-trigger.ts` |
| Keep as-is | Outbound draft→preview→confirm→send + audit snapshots; calendar create/list. | `src/lib/agent/composio-tools.ts`, `audit_log` |

**Phase 1 done when:**
- AgentMail code, dependency, and env vars are gone.
- An email to George's M365 mailbox fires `OUTLOOK_MESSAGE_TRIGGER` → `agent_events` → George runs (existing path).
- Email send and calendar booking still work via Composio.

---

## Phase 2 — Event-driven kickoff (the real product shift)

> New customers arrive by *event*, not by a human clicking "New" in the UI. George kicks off on his own.
>
> **Status: 🟡 in progress (2026-06-24).**
> Done: stale Onyx facts stripped from `01` (`03` already clean), synced. **Scribe wired** as a remote HTTP MCP server (`src/lib/agent/scribe.ts`) into both run paths (chat + autonomous); Fireflies tools + the Composio Fireflies config/labels removed; prompt updated (Scribe joins/records, George reads after). SDK remote-MCP support verified in `sdk.d.ts`; Scribe token auths (200 on `initialize`); clean build green.
> **Kickoff *playbook* done (2026-06-24):** the fluid kickoff motion is in `03` (Onboarding → "Default kickoff motion") and synced — check calendar → if no meeting, ask the *salesperson* for the contact (draft-first, never cold-contact the customer) → coordinate + book → after the meeting, pull the Scribe transcript/insights → draft the success plan. This works in **chat-driven** onboarding today; the Zoho trigger will later just *fire* this same motion.
> **Parked by Rahul (2026-06-24):** Zoho — pending George's email account being connected to Zoho. **Zoho tools + the new-customer/closed-won *trigger* wait on this** (the motion they fire already exists). `scripts/discover-zoho.ts` is staged to read the real Zoho slugs once connected; `process-event.ts`'s Composio branch must fork on toolkit/event_type (today it assumes Outlook-mail shape) when Zoho lands.
> **Scribe mechanism resolved:** Scribe auto-joins meetings on its own (it's a note-taker); George needs **no dispatch/attendee step** — he just pulls the transcript + insights + attendees *after* the meeting via the Scribe tools. The kickoff behavior therefore ends with "after the meeting, pull the Scribe transcript → draft the success plan."
> **Still open:** rotate the `scb_live_…` Scribe token (it lived in chat as plaintext).

**Outcome:** A new lead/order in Zoho **or** an inbound email triggers George to: resolve-or-create the customer → check for a kickoff meeting → schedule one if missing → ensure Scribe listens → draft the success plan from the transcript.

| Area | Deliverable | Files / tables |
|---|---|---|
| Zoho CRM tools | Read (lead/contact/account/deal) + write (log activity, update stage). Prefer via Composio (`COMPOSIO_AUTH_CONFIG_ZOHO`) for consistency with M365; direct Zoho REST only if a needed trigger/action isn't covered. | new `src/lib/agent/zoho-tools.ts` (or extend `composio-tools.ts`); `integrations` row provider='zoho' |
| Zoho trigger | New-lead / new-order in Zoho → webhook → `agent_events` (source='zoho'). Reuse the existing event router + dedupe + `after()` handoff. | new `src/app/api/webhooks/zoho/route.ts` (or Composio trigger), `agent_events` |
| Kickoff behavior | Autonomous run framing: "new partner with no kickoff meeting → propose times and send the invite; if a meeting already exists → ensure Scribe will attend." Driven by playbook, not hardcoded steps. | `src/lib/agent/process-event.ts`, `run-autonomous.ts`, prompt |
| Scribe (replace Fireflies) | Swap the 2 Fireflies tools for Scribe MCP (`list_meetings`, `get_meeting`, `get_transcript`, `get_insights`). Transcript-ready → draft success plan. | remove Fireflies tools from `composio-tools.ts` + `COMPOSIO_AUTH_CONFIG_FIREFLIES`; add Scribe MCP tools |
| Customer resolution | Reuse existing sender→customer resolution (contact email, then domain) for the email trigger; Zoho id mapping for the Zoho trigger. | `process-event.ts`, `customers`/`contacts` |

**Phase 2 done when:**
- A new Zoho lead/order fires a webhook → George creates/finds the customer and starts the kickoff motion.
- An inbound email from an unknown-but-allowed sender does the same.
- George schedules a kickoff meeting via Composio calendar when none exists.
- A finished meeting's Scribe transcript triggers a drafted success plan.
- Fireflies is fully removed.

---

## Phase 3 — Harden the macro layer (the one real engineering chunk)

> Make the autonomous spine durable and time-aware. This is where the rebuild spec was genuinely right.
>
> **Architecture note:** the atomic claim on `agent_jobs.running_run_id` already guarantees *correctness* under any concurrency. So every "what about scale?" concern here (durable queue, multiple replicas) is an *efficiency* question we can defer, not a correctness one we must solve now.

**Outcome:** Scheduled work actually fires in prod; inbound work survives restarts and retries; George wakes himself for multi-day follow-ups.

| Area | Deliverable | Status |
|---|---|---|
| **Cron firing** | **✅ done (2026-06-24, increment 1).** In-process `node-cron` started from `src/instrumentation.ts` (persistent Railway server — no external pinger). Tick orchestration extracted to `src/lib/agent/cron-tick.ts` (`runCronTick()`), called by both the scheduler and the HTTP route (kept for manual testing). Guards: nodejs-runtime-only, build-phase skip, in-process overlap guard. Prod on by default; dev opt-in via `SCHEDULER_ENABLED`; `SCHEDULER_VERBOSE` logs every tick. Verified locally: boots once, tick fires, `runCronTick` runs clean. **Prod check pending next deploy** (look for the `[scheduler]` boot line in Railway logs). |
| Durable queue (BullMQ + Redis) | **⏸️ deferred** — not the one-piece-to-import-wholesale after all. The claim+sweep backstop is correct for current (single-partner) volume; standing up Redis now is the speculative abstraction we said not to build. **Re-trigger:** sweep latency actually hurts, a real DLQ is needed, or we go multi-replica. | logged deferral |
| Multi-day timers | Deterministic scan (a standing job, now that cron fires) wakes George for follow-ups / cadence-due. The timer is trivial on the firing scheduler. | increment 3 |
| **Follow-up + escalation** | Polite follow-up N times, then escalate. **⚠️ The hard part is reply-detection, not the timer:** knowing a follow-up is due means correlating inbound Outlook replies to George's sent thread (via `conversation_id`) to answer "did they respond?" + "when does the clock reset?" — a product question for Rahul. **Scope before building (increment 2).** | needs scoping |
| Document sign-off (optional) | *Only if success-plan sign-off is a real Onyx step:* DocuSeal tool + "poll unsigned / follow up" timer. Defer otherwise. | deferred |

**Phase 3 done when:**
- ✅ Standing jobs fire on schedule (in-process scheduler live; prod-verify on next deploy).
- Inbound work survives restarts (today: claim + 5-min sweep; finer durability deferred to BullMQ).
- George sends a follow-up automatically after an unanswered thread, and escalates after the limit *(blocked on reply-detection scoping)*.

**Prod enablement:** nothing to set — `NODE_ENV=production` (Railway's `next start`) turns the scheduler on by default. `CRON_SECRET` is now only needed for the manual HTTP test route, not the production path.

---

## Phase 4 — Observability + UI center-of-gravity

> Make George's decisions visible, and make the product feel like an agent, not a SaaS app.

**Outcome:** Every George run is traceable; chat + the approval queue are the product, with CRUD demoted to context.

| Area | Deliverable | Files |
|---|---|---|
| Tracing | Add agent-run tracing/observability (LangSmith or equivalent) over `run-autonomous.ts` / chat. V1 has only `audit_log`. | `src/lib/agent/*` |
| Invert UI | Promote chat + `/actions` approval queue as the primary surfaces. Demote `/customers` detail to a read-only "what George knows" context view. Nothing deleted that breaks. | `src/app/(app)/actions/`, `src/app/(app)/customers/`, `src/app/(app)/chat/` |
| Sentiment/health (optional) | Longitudinal sentiment from email history feeding proactive action — from the rebuild spec, if wanted. | `customer_health` |

**Phase 4 done when:**
- Every autonomous run is inspectable end-to-end in a trace.
- A new user lands in chat / actions, not a dashboard, and the CRUD reads as reference.

---

## Sequencing & rationale

1. **Phase 0 first** — cheapest, and it's the change that most directly fixes "not agentic enough." Do it before anything else so every later phase runs against the fluid model.
2. **Phase 1** — small deletion; clears the email ambiguity before building new triggers on top.
3. **Phase 2** — the real product shift (event-driven). Builds on the now-clean single email spine.
4. **Phase 3** — the only substantial engineering. Do it once the trigger surface that feeds it exists.
5. **Phase 4** — polish; valuable but not blocking.

**Net:** weeks of additive/subtractive work on a foundation you already trust — versus months to rebuild to roughly where V1 already is. The rebuild instinct was the right *diagnosis* (scope drift, over-building) with the wrong *cure*. We delete the drift, not the foundation.
