# George — Objectives, Owners, and the Clock

**Design for Phase 3, increment 2 (follow-up / escalation).** Captured from Rahul's spec 2026-06-24. Confirm before the migration lands.

This is the model that makes George "keep the ball moving" — chasing the things a partner onboarding needs, following up on his own, escalating to the right human, and reporting on a cadence.

---

## 1. Owners — George reports to a person, not a void

A handful (~4–5) of GetOnyx people close deals and kick off customers. **Every customer is associated with exactly one owner** — the rep who brought/closed them. (Owners are discovered per customer, never hardcoded.)

George uses the owner as his human anchor:
- **When something is unclear, George asks the owner**, gets confirmation, then takes the next action.
- **George reports to the owner on a regular cadence** about what's moving and what's stuck.
- **Escalations go to the owner** when George is blocked or in doubt.

Model: reuse `customers.owner_user_id` (already exists) → an Onyx `org_members` row (the 4–5 owners are George users). George sets it when he learns who brought the deal (from the Zoho deal owner later; from the kickoff/owner manually for now).

---

## 2. The kickoff → objectives flow

1. George is invited to the kickoff meeting; **Scribe** records it; George pulls the transcript.
2. From the transcript, George builds the **plan** — the agreed milestones with their deadlines.
3. George also layers in the **standard onboarding objectives** he needs regardless of what the meeting covered (the things required to actually onboard a partner on the platform), e.g.:
   - partner **name**
   - partner **logo** (PNG/JPG)
   - **initial admin user**
   - …then **first training session**, and so on.
4. George checks the transcript against those standards. **If something required is missing, George flags the owner first** ("did you guys miss this point?"). If the owner confirms it's needed, George reaches out **directly to the customer's key contact** — whom George identifies from the transcript — to get it.
5. Once agreed, George sends the first ask / starts the cadence on each objective. **The clock starts.**

---

## 3. The Clock — objective-based, not reply-based

This is the core rule. Each objective George is chasing has a clock:

- **The clock stops only when the objective is achieved** — the logo file actually arrives, the admin user is actually created, the confirmation is actually given.
- **A reply is not achievement.** An out-of-office auto-reply, a "will do soon," or any message that isn't the deliverable does **not** stop the clock.
- Whether an objective is achieved is **George's judgment** — he reads the thread + attachments and decides "got it" vs "not yet." (So detection is agentic, not a deterministic `conversation_id` reply-match.)
- **Default interval: 48h.** If the objective isn't achieved, George follows up (politely), again after the next interval, etc.
- **CC rule:** George always CCs the key people on **both sides** (customer + Onyx) involved in that objective. Who to CC comes from the kickoff (the owner knows); **if unclear, George asks the owner** — and that pause/question **resets the clock**.
- **Doubt → ask the owner, reset the clock.** George's whole job is to keep the ship moving in the right direction; whenever he's unsure, he checks with his person rather than guessing.
- **Escalation:** after N unachieved follow-ups (default ~2, i.e. 48h → 96h → escalate ~144h), George escalates to the owner with full context.

The deterministic part is the **timer** (`next_followup_at`). The hard part — "is it done?" — is George's call on each follow-up run.

---

## 4. Per-customer checklist + reporting (the cron jobs)

- Each customer has its **own checklist of objectives** with their own clocks. George's standing job: keep everything moving in the right direction.
- The now-firing scheduler runs a **scan**: find objectives that are `awaiting` with `next_followup_at <= now` → wake George per objective (or batched per customer) to judge achievement and act (follow up / mark done / escalate / ask owner).
- A separate **reporting cadence** (a standing job) wakes George regularly to summarize each customer's status to its owner.

---

## 5. Data model

> **✅ Migration applied 2026-06-24** — `supabase/migrations/20260624000000_objectives.sql` (table + enums + indexes + RLS, verified live).
> **✅ Tools live 2026-06-24** — in `src/lib/agent/tools.ts`: `set_customer_owner`, `create_objective`, `list_objectives`, `list_due_objectives`, `update_objective`; `get_customer` now also returns `owner` + `objectives`. Available on both chat and autonomous paths.
> **✅ Scheduler scan live 2026-06-24** — `src/lib/agent/run-objectives-scan.ts`, wired into `runCronTick()`. Each tick: finds due objectives, groups by customer (bounded per tick, budget-guarded), leases their clocks (anti-respin), and wakes George autonomously per customer in a reviewable `channel='cron'` session to judge-and-act.
> **✅ Playbook live 2026-06-24** — "Objectives & the clock" section + the standard objective set added to `core/03` and synced. The standard set lives in the playbook (editable), not in code.
> **✅ Achievement-detection tools live 2026-06-24** — `search_emails` (Composio `OUTLOOK_SEARCH_MESSAGES`, KQL) + `get_thread` (Composio `OUTLOOK_QUERY_EMAILS` by `conversationId`, inbox + sent) in `composio-tools.ts`. Slugs discovered via Composio, not guessed. George judges "achieved vs not" by reading the actual thread/attachments — closing the earlier reply-detection gap. Referenced in the prompt + the objectives playbook + the scan prompt.
> Build green; full tick path verified in-process. The `cadences` multi-active relax is deferred to land with its tool change.

**Reuse:** `customers.owner_user_id` for the owner association.

**New table `objectives`** (one migration). Fields marked **★** were added after validating against a reference onboarding (§7) — get them in the first migration since it's append-only.

| Column | Purpose |
|---|---|
| `id`, `org_id`, `customer_id` | scope |
| `title`, `description` | e.g. "Obtain partner logo (PNG/JPG)" |
| `kind` | `standard` \| `from_meeting` \| `ad_hoc` |
| `status` | `pending` \| `awaiting` \| `achieved` \| `blocked` \| `cancelled` |
| **★ `responsible_side`** | `customer` \| `onyx` — half of all kickoff objectives are Onyx-owed (domain, demo deck, price-list normalize), not customer-owed |
| `responsible_contact_id` | FK `contacts` — the customer-side person George chases (when `responsible_side='customer'`) |
| **★ `owner_side_user_id`** | FK `org_members` — the Onyx role-owner George nudges (when `responsible_side='onyx'`); distinct from the customer's relationship owner |
| `cc_emails` | jsonb — the key people both sides to CC |
| **★ `due_date`** | hard external deadline (e.g. a customer's upcoming prospect meeting). Drives **deadline-aware** escalation: urgency = min(default cadence, deadline-derived) |
| `followup_interval_hours` | default 48 |
| `next_followup_at` | the clock |
| `followup_count` | nudges sent so far |
| `max_followups` | default 2 before escalation |
| `thread_conversation_id` | Outlook thread George is watching |
| `source_session_id`, `achieved_at`, timestamps | provenance + audit |

**Owner model:** `customers.owner_user_id` stays the **relationship anchor** (the rep who closed/owns the customer), used for escalation and reporting. Each *objective* additionally routes to the right Onyx **role** via `owner_side_user_id` (e.g. a technical vs. a support role-owner). One anchor, many role-owners — all discovered per customer, never hardcoded.

**Tools George gets:** `set_customer_owner`, `create_objective` (incl. the standard-set helper at kickoff), `list_objectives` / `list_due_objectives`, `update_objective` (status/clock). All org-scoped, like the existing tools.

**Scheduler scan:** a standing job (or dedicated tick step) that finds due objectives and wakes George autonomously per the judge-and-act loop in §3.

**Standard objective set** lives in the knowledge playbook (so it's editable without code) — see the validated list in §7.

**Schema flag — multiple cadences per customer.** A customer can run two concurrent cadences (e.g. a support rollout + a technical track). The V1 `cadences` table enforces *one active per customer* (unique partial index). This needs relaxing to allow multiple concurrent active cadences per customer — a small follow-on migration, called out so we don't forget.

---

## 6. Decisions (resolved 2026-06-24)

1. **Objectives = new `objectives` table** (not an extension of `onboarding_steps`). Steps are milestones; objectives carry clocks, CC lists, a responsible side/contact, and achievement state. Objectives may reference a step if useful.
2. **Standard objective set** — confirmed (generic, customer-agnostic): admin user(s) → logo → branding/colors → NCE price list → tenant connection/links → support domain → power-user list → **sender whitelisting/deliverability** → power-user training. Lives in the editable playbook.
3. **Escalation defaults** — 48h interval, 2 follow-ups, then escalate, as the baseline; **overridden by `due_date`** when an objective has a hard deadline (escalate ahead of the date). Per-customer overridable.
4. **Reporting cadence** — weekly digest per customer, surfaced to that customer's relationship owner, in a *done / pending / at-risk / next-milestone* shape; plus event-driven flags (deadline at risk, objective stuck after 2 nudges).

---

## 7. Reference example — one real onboarding (illustrative only)

> **The names, the customer, and the specific objects below are NOT baseline data.** They come from a single example kickoff transcript used to pressure-test the model. George does **not** hardcode any of these people or this customer. He **discovers** the owner, role-contacts, customer contacts, and objectives *per customer* — from the Zoho deal owner and the kickoff transcript — every time. This section exists only to show the model surviving contact with a real meeting and to justify the §5/§6 fields.

What the reference meeting confirmed about the *general* model:

1. **Objectives are two-sided.** ~half the kickoff asks were vendor-owed (domain setup, demo collateral, price-list normalize), not customer-owed. George chases the customer directly, **nudges the responsible internal role, escalates to the relationship owner.** → `responsible_side` + `owner_side_user_id`.
2. **The clock is deadline-aware.** A customer-driven hard deadline compresses follow-up and escalation below the 48h default. → `due_date` drives urgency.
3. **Owner + role-contacts.** One relationship anchor, plus role-specific internal contacts (technical / support). George routes each objective to the right role.
4. **Deliverability is a first-class standard objective.** The customer's security stack can silently block the agent's email. For an email-driven agent that's existential — whitelisting must be tracked and **verified** (send a test, confirm receipt), not assumed.
5. **Achievement detection starts at the transcript.** Some objectives complete *during* the meeting; George marks those done from the transcript and does not re-chase — the "objective achieved, not reply received" rule applied at transcript-analysis time.

These five are general onboarding dynamics, not facts about any one customer.
