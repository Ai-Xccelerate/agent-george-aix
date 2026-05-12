# Agent George — Lifecycle Steps

Agent George operates across three lifecycle phases. Each phase has concrete steps, inputs George needs, actions George performs, and what George reports back to the CSM.

---

## Phase 1 — Onboarding

Triggered when a new partner contract is signed and handed to the CSM by sales.

### Step 1.1 — Intake
**Inputs received:** NDA (Zoho Sign), Contract (Zoho Sign), Order Form (with term, pricing, billing cadence, Program Manager assignment, solution scope).

**George does:**
- Parses the order form to extract: partner name, contract term, billing cadence, included hubs (Support / Transition / Sales), Program Manager assignment.
- Creates the Onboarding Hub space for the partner.
- Pre-ticks "Contract Signed".
- Records the salesperson and (if applicable) Program Manager against the partner.
- Notifies the CSM that a new partner is ready for kickoff.

**George reports:** "New partner ready for kickoff: [term, pricing, scope, sales owner]."

### Step 1.2 — Kickoff Call Prep
**George does:**
- Drafts the kickoff agenda from the standard template.
- Pre-fills the Onboarding Hub with the salesperson, Program Manager, and CSM contacts.
- Confirms calendar slot proposed by sales/CSM with the partner contact.

### Step 1.3 — Capture Partner Admin & Start Date
**Inputs collected during/after kickoff:**
- Partner Admin: first name, last name, email, domain (used for login subdomain), customer-facing contact email, contact phone (optional).
- Agreed Start Date (typically the day of the kickoff call).
- Agreed cadence frequency for ongoing calls.
- Agreed onboarding timeline.

**George does:**
- Stores admin record. Flags any missing required field.
- Records start date and cadence in a structured store (not just calendar).
- Sets target dates on every downstream Onboarding Hub task based on the agreed timeline.

### Step 1.4 — Commercial & Supplier Setup
**George tracks completion of:**
- Supplier Onboarding (partner sets Onyx up as a supplier on their side).
- Partner Onboarding for Invoicing (finance/AP contacts collected and passed to Onyx finance).
- Funding & Co-op Guide acknowledged (standard PDF sent to partner).

**George does:** Chases the partner admin if any of these stall past their target date. Hands billing contacts to Onyx finance.

### Step 1.5 — Partner Admin Provisioning *(blocking gate)*
**George does:**
- Creates the partner admin in Support Hub → CSP Partner Management with the collected data.
- Watches for the verification email confirmation. Updates status from "Email Verification Pending" → "Active" in the Onboarding Hub.
- Schedules the ~10-minute Partner Control Panel admin training (live call or links the recorded walkthrough).
- Records "Partner Center Link Connection" status from the Program Manager when Transition Hub is in scope.

**George reports:** "Partner Admin active. Internal user onboarding can begin."

### Step 1.6 — Partner Internal User Onboarding
**George does:**
- Sends the partner admin the templated Awareness Communication (or notes when they decline to use it).
- Opens a data collection form for the internal user list.
- For each user provided: either creates the user in Support Hub directly, or — when the partner admin adds users via the Partner Control Panel — auto-approves from the Pending Request List (per current rules) and ticks the hub task.
- When bulk spreadsheet is provided, hands to the back-end bulk import.
- Schedules / supports an enablement demo (often on the partner's weekly team call).

**George reports:** "[N] internal users active; [M] pending; awareness comm sent on [date]."

### Step 1.7 — End Customer Onboarding (Journey B)
**George does:**
- Sends the end-customer–oriented Awareness Communication template to the partner admin.
- Opens a data collection form per end customer (typical size: 1–5 users).
- Adds end customer users (only the partner admin or Onyx is permitted to do this — partner internal users cannot).
- Tracks the end customer webinar / handover (typically run by the partner admin).

**George reports:** "End customer [name] onboarded with [N] users."

### Step 1.8 — Onboarding Complete
**George does:**
- Confirms every Onboarding Hub task is green.
- Locks the start date and rolls the partner into the Health & Cadence phase.

---

## Phase 2 — Health, Cadence & Reporting

Runs continuously for every active partner.

### Step 2.1 — Cadence Management
**George does:**
- Stores cadence frequency (weekly / biweekly / monthly) per partner in a structured store.
- Generates calendar invites or surfaces upcoming meetings to the CSM.
- Reminds the CSM of any partner whose cadence call is missing on the calendar.

### Step 2.2 — Utilization Data Pull (Automated)
For every upcoming cadence call (or on-demand), George pulls from the Support Hub:
- Total active users
- Total messages
- Total flags
- Total recalls
- Period-over-period deltas

This replaces the manual collection Indu's team does today.

### Step 2.3 — Out-of-Scope Categorization
**George does:**
- Reads the shared QA mailbox feed (notifications when the bot could not answer).
- Categorizes each question (operational, policy, out-of-domain, etc.).
- Suggests responses to the QA team and tracks resolution.

### Step 2.4 — Cadence Deck Preparation
**George does:**
- Auto-generates the partner's PowerPoint deck from the templated layout using the data from 2.2 and 2.3.
- Delivers it to the CSM before the meeting (target: night before).
- Highlights anything notable: spikes, dips, repeated out-of-scope themes, unresolved flags.

**George reports:** "Cadence deck ready for [partner], call on [date/time]. Highlights: [...]"

### Step 2.5 — Flag Management
**George does:**
- Watches the Flag Management screen for new in-app flags.
- Routes flagged questions to the right responder.
- Tracks response SLA and pings on overdue items.
- Notifies the CSM if an end customer reaches out following a flag.

### Step 2.6 — Inbound Triage (CSM-facing)
**George does:**
- Receives questions from partner admins (when authorized — initially email parsing, later a direct chatbot).
- Handles common partner-admin requests: how to add a user, bulk-add from spreadsheet, Partner Control Panel data visibility, etc.
- Escalates anything outside its scope to the CSM with context.

---

## Phase 3 — Success Sprint & Renewal Health

### Step 3.1 — 30 / 60 / 90 Day Check-ins
For partners on the full CSP Growth Engine solution:
- George prepares structured check-in agendas and data packs at 30, 60, and 90 days post–Start Date.
- Compares utilization against expected ramp.
- Flags accounts that are below activation thresholds.

### Step 3.2 — Risk & Opportunity Signals
**George surfaces:**
- Partners with declining utilization
- Partners with rising unresolved flags
- Partners whose internal user count has plateaued
- End customers with no recent activity
- Partners approaching renewal with weak engagement

### Step 3.3 — Portfolio Report to CSM
On a regular schedule (e.g. weekly) and on demand, George produces:
- Status of every partner across onboarding and ongoing phases
- Anything stalled past its target date
- Top issues by category from QA mailbox and flags
- Recommended next actions for the CSM

**George reports:** A single conversation surface where the CSM can ask "what needs my attention today?" and get a prioritized list.

---

## Cross-Phase: George's Reporting Contract with the CSM

Every action George takes is:
- **Logged** with timestamp and attribution.
- **Reversible** by the CSM where the underlying system allows.
- **Surfaced** to the CSM proactively if it changes partner state, or on-demand on any other question.

George's value is measured by how much manual coordination, data pulling, and follow-up the CSM no longer has to do — while never letting a partner slip through silently.
