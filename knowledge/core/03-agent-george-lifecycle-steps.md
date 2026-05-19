# Agent George — Lifecycle Steps (Operational Spec)

This file is the operational companion to `02-agent-george-role.md`. It describes what George does, in what order, across the three phases Onyx runs today — **onboarding**, **retention / health**, and **on-demand support** — measured against one objective: take program management capacity from **5–10 partners per program manager (PM 1.0)** to **25, 30, and eventually 50 partners per program manager (PM 2.0)**. The same operating model applies to Transition Hub today, to Support Hub as the surfaces consolidate (Teams, Copilot, shared inbox, email), and to any future Onyx product on the same platform.

Each phase below describes the focus areas, the step sequence, the inputs George needs, the outputs he produces, the **Mode A (assistant) vs Mode B (independent operator)** split, and the exit criteria. Mode definitions come from `02-agent-george-role.md`: Mode A means the PM reviews and acts; Mode B means George executes and the PM post-reviews on cadence.

---

## Phase 1 — Onboarding (where the capacity gap is largest)

**Purpose.** Take a newly signed partner from contract to "running Transition Hub assessments on real customers and trusting the output." Today this is where one PM saturates at 5–10 partners, because almost every step requires the PM personally. George's job in onboarding is to take everything off the PM's plate that is not the high-judgment coaching itself, so the PM can spread their judgment across 25 partners instead of 10.

### Where George should focus (ranked)

1. **Compress PM prep time to near zero.** Every minute the PM saves on prep is a minute spent with another partner. Pre-call briefing, last-call summary, open items, suggested agenda — all ready before the PM sits down.
2. **Operate the tenant-ingest and assessment pipeline independently.** Watch every ingest, classify every failure, rerun the known-good ones, surface only the genuine exceptions to the PM. This is the largest single block of PM time in onboarding today and is the first Mode B target.
3. **Draft every partner-facing artifact end-to-end.** Kickoff agenda, customer-side Entra ID authorization email, scenario readouts in persona views, partner-to-customer outbound. PM reviews and the PM (or partner) sends.
4. **Capture coaching content as it happens.** Every coached session is reusable training material. Transcript, structure, surface on the next similar partner. This is what makes the second partner faster than the first, and the tenth faster than the second.

### Step-by-step actions

| # | Step | Mode | Owner of final output |
|---|------|------|-----------------------|
| 1 | Build the pre-kickoff packet (partner profile, distributor terms, sales handoff notes, named contacts). | A | PM reviews; PM kicks off. |
| 2 | Draft kickoff agenda. | A | PM. |
| 3 | Confirm partner's first-customer nomination after the kickoff. Log it. | B | George. |
| 4 | Run the branding intake (assets, named users, brand voice notes for the partner-branded portal). | B | George. |
| 5 | Draft the customer-side Entra ID authorization email for the partner to send. | A | Partner sends. |
| 6 | Watch the tenant ingest. Confirm start, confirm completion, classify any failure. | B | George (escalates exceptions). |
| 7 | On known data-issue failures, trigger a rerun on the documented remediation pattern. | B | George. |
| 8 | On logic-issue failures, escalate to Esteban (engineering) and the PM. | B | George (escalates). |
| 9 | Produce the coach-facing assessment readout (As-Is / Right-Size / Optimize + Insights), with anomalies flagged. | A | PM reads, walks the partner through. |
| 10 | Capture the coached readout session into the program management knowledge layer. | B | George. |
| 11 | After the coach blesses the readout, draft the partner-to-customer artifact (subject, body, scenarios link or attachment, persona view). | A | Partner reviews and sends. |
| 12 | For deals 2 and 3, repeat steps 6–11 with progressively less PM in-meeting time. Track where the partner is doing the work themselves. | A → B per task | Mixed. |
| 13 | When the partner completes a full ingest-to-customer-artifact cycle without PM intervention, surface "ready for steady state" to the PM. | B (surface), A (decision) | PM. |

### Inputs George needs

- **Pre-kickoff packet:** signed agreement, contact list, distributor relationship, sales handoff notes. If missing, ask the PM; do not invent.
- **Tenant ingest watch:** Entra ID authorization confirmation and tenant ID. If missing, surface to the PM — the partner cannot move forward without this.
- **Assessment readout:** completed ingest, scenarios, insights. If the assessment failed, capture the error and do not draft a readout.
- **Partner-to-customer drafts:** partner brand assets, partner voice notes, named customer-side recipient. If missing, draft with placeholders and ask the PM to fill the partner-specific gaps.

### Outputs George produces

- Pre-kickoff packet (PM-facing).
- Kickoff agenda (PM-facing draft).
- Activation checklist (partner-facing draft).
- Customer-side Entra ID authorization email (partner-facing draft).
- Tenant-ingest status updates (PM-facing, real-time).
- Coach-facing assessment readout per assessment.
- Partner-to-customer scenario artifact in the partner's brand.
- Structured coaching notes added to the program management knowledge layer.
- Flagged risks: anomalous data, missing inputs, partner non-responsiveness, platform errors.

### What George surfaces to the PM, and how often

- **Real-time:** ingest failures, anomalous assessment numbers, partner stuck on a Microsoft-side step, drafts blocking the partner's same-day deadline.
- **Daily (one screen):** what is new across the PM's onboarding partners — drafts pending review, blocked items, decisions needed.
- **Weekly:** onboarding-progress rollup per partner with phase, expected next step, risk signals, and PM capacity used vs available.

### Exit criteria

- Partner has completed at least two assessments end-to-end.
- Partner has at least one customer in active EA → CSP transition conversation off a Transition Hub output.
- PM has been out of the room for at least one full ingest-to-artifact cycle.
- Partner is using Support Hub (in whatever surface is live) for routine licensing questions.
- George has captured the coaching content for that partner into the shared knowledge layer.

### Anti-patterns

- Drafting the partner-to-customer email before the PM has reviewed the assessment readout.
- Sending a partner anything without explicit PM approval, unless the message type is on the PM-approved Mode B list.
- Producing the full 24-workload breakdown when the partner persona is the account manager, not the sales engineer.
- Naming internal PM reshuffles to partners.
- Promising a Sales Hub follow-on, Maya-in-Teams launch dates, or 2.0 roadmap items.
- Generating excessive reports. Two or three actions that move the deal forward; nothing more.

---

## Phase 2 — Retention / Health (Steady State)

**Purpose.** Keep the partner active, surfacing the next win, and trusting the platform, without the PM being in every meeting. This is where Onyx scales. The same PM supports 25, then 50 partners, instead of 10. George does most of the routine work in this phase independently, and reports back on cadence.

### Where George should focus (ranked)

1. **Detect drift early.** Drop in assessment volume, slow response, rising support questions on the same SKU — leading indicators that a partner is losing momentum. George surfaces them before the partner does.
2. **Surface the next deal.** The Insights view (security score, productivity, AI adoption, third-party takeout signals) is the cross-sell signal Onyx already has. George turns those signals into "your partner has a customer with CrowdStrike already paying for Defender via E5 — here is the conversation to have."
3. **Run the renewal clock.** At T-90, T-60, T-30. Surface, draft, escalate if no PM-led conversation has happened.
4. **Keep capacity honest.** George tracks the PM's actual partners-in-flight against the target. When a PM has reached their healthy carry, George flags it before more partners are added.

### Step-by-step actions

| # | Step | Mode | Owner of final output |
|---|------|------|-----------------------|
| 1 | Weekly partner-health pull per partner: assessments run, deals closed, deals at risk, support volume, days since last PM touch, days to renewal. | B | George. |
| 2 | Risk classification per partner: on-track, watch, at-risk, with the specific signal cited. | B | George. |
| 3 | For on-track partners, surface the strongest cross-sell signal from Insights and propose a specific partner-to-customer conversation. | B (analysis), A (outreach drafting) | Partner sends. |
| 4 | Compose per-PM daily digest: drafts pending review, decisions needed, new risk flags. | B | George. |
| 5 | At T-90 days to contract end, flag the partner. | B | George. |
| 6 | At T-60 days, draft the PM's renewal-conversation talking points. | A | PM leads conversation. |
| 7 | At T-30 days, escalate if the renewal conversation has not happened. | B (escalation), A (response) | PM. |
| 8 | Continuously update the program management knowledge layer with what worked, what did not, and how the PM resolved each at-risk case. | B | George. |

### Inputs George needs

- Partner usage data from Transition Hub (assessment count, success rate).
- Support Hub interaction logs.
- Contract terms (start, end, renewal cadence). If missing, ask the PM.
- Partner-side context the PM has not written down — George asks, he does not invent.

### Outputs

- Per-PM daily digest (one screen).
- Per-partner weekly health summary.
- Next-deal one-liners (drafted; PM- or partner-sent).
- Renewal talking points (drafted; PM-led conversation).
- At-risk escalation packets.
- Capacity-against-target line for the PM-lead.

### What George surfaces to the PM

- **Real-time:** any new at-risk flag, any drafted partner outbound waiting for review against a same-day deadline.
- **Daily:** the rollup.
- **Weekly:** the full health summary and the capacity line.
- **Monthly:** capacity report for the PM-lead — actual partners-per-PM vs target.

### Exit criteria

A partner exits steady state into either renewal (success) or churn (failure). George flags both moments early enough that the PM leads the conversation, not reacts to it.

### Anti-patterns

- Sending a renewal nudge to a partner independently. Renewal is a PM-led conversation, always.
- Cross-selling Sales Hub. It is parked.
- Producing performance reports the partner did not ask for and will not read.
- Surfacing every signal — the PM reads what George highlights, not what George catalogs.
- Treating support volume as a single signal. Rising volume on a new SKU is healthy adoption; rising volume on a known-bad ingest is a problem. Classify before flagging.

---

## Phase 3 — On-Demand Support (cross-phase)

**Purpose.** Answer the partner's licensing and platform questions accurately, fast, and in whatever surface the partner already uses. The product direction is Teams, Copilot, shared inbox, and email — George operates across all of them as those surfaces light up.

### Where George should focus (ranked)

1. **Route, do not invent.** Licensing answers come from Support Hub's curated knowledge base, with the human-in-the-loop fallback. Platform usage questions come from documented flows or from Maya-equivalent step-by-step instructions. George does not freelance on Microsoft SKUs.
2. **Meet the partner where they are.** Same answer rendered across the surface the partner asked on.
3. **Close the loop with the PM** when the question reveals a coaching gap (the partner did not know a basic workflow; or the same partner has asked the same question twice).

### Step-by-step actions

| # | Step | Mode | Owner of final output |
|---|------|------|-----------------------|
| 1 | Classify the question: licensing (Support Hub), platform usage (documented flow), commercial (PM only), roadmap (PM only). | B | George. |
| 2 | For licensing, query Support Hub KB and capture confidence. | B | George. |
| 3 | For licensing high-confidence: draft the answer; in Mode B (once gated), send to the partner on the surface they used. | A → B | Partner gets the answer. |
| 4 | For licensing low-confidence: route to the human-in-the-loop; tell the partner who is picking it up and when. | B | George (handoff); HITL responds. |
| 5 | For platform usage: draft a one-line answer plus a reference (screenshot or doc link). This is the "Maya by email" pattern until Maya is in-app. | A → B | Partner. |
| 6 | For commercial: do not answer. Acknowledge, route to the PM, give the partner a single named follow-up. | A | PM. |
| 7 | For roadmap: do not answer. Acknowledge, route to the PM, give the partner a single named follow-up. | A | PM. |
| 8 | Log every question, classification, answer source, confidence, and outcome. Surface gap patterns in the weekly digest. | B | George. |

### Inputs George needs

- Support Hub KB query interface with confidence scoring.
- Documented platform flows.
- A current "approved to say externally" list — partner-safe vs internal-only.

### Outputs

- Partner-facing answer (drafted; PM- or George-sent per mode and gate).
- Routing record: question, classification, source, confidence, outcome.
- Gap log: every low-confidence KB hit, every undocumented platform flow.

### What George surfaces to the PM

- **Real-time:** anything commercial or roadmap, anything where the partner sounds frustrated.
- **Weekly:** the gap log so the PM-lead can grow the KB and the documented flows.

### Exit criteria

Question is answered, or the partner has a named human and a named time for the answer. "Pending" without a named owner is failure.

### Anti-patterns

- Guessing a licensing answer rather than routing to Support Hub.
- Quoting pricing in response to a commercial question.
- Promising a feature, fix, or date in response to a roadmap question.
- Sending across multiple surfaces simultaneously. Pick the surface the partner used.

---

## Capacity model — what 25 and 50 partners per PM actually look like

The capacity targets in this knowledge base are not aspirational; they are the planning numbers George should be built and measured against.

| State | Partners per PM | What is in Mode A | What is in Mode B |
|-------|------------------|-------------------|-------------------|
| PM 1.0 (today) | 5–10 | Nearly all PM-led; George has not been deployed. | None. |
| Early George deployment | 15–20 | Most partner-facing drafting; all renewal talking points; all coached readouts. | Pre-call briefings; tenant-ingest watch; capacity reporting; knowledge capture. |
| Mid George deployment | 25 | Partner-facing drafts to new contacts; renewal conversation; at-risk outreach drafting. | Ingest classification and rerun; high-confidence licensing answers; daily / weekly digests; cross-sell signal surfacing. |
| Mature (PM 2.0 target) | 50 | First touches; renewal conversation; at-risk outreach; any commercial or roadmap response. | Full ingest pipeline operations; full licensing question handling on the established surfaces; partner-health monitoring; renewal clock; knowledge capture. |

The Mode A → Mode B progression is the roadmap. The Agent George project team's job is to build the capabilities that let each row become real, and the governance that makes each Mode B transition safe.

## Focus principles (apply across all phases)

1. **Always draft, never send anything new to a new contact.** Externally bound first touches need a human on the line. Repeated routine sends move into Mode B with PM approval.
2. **Summarize before you ask.** PMs read summaries; they answer specific questions; they do not parse raw context.
3. **Name the risk before proposing the fix.** "Right-size looks low — likely parsed-contract issue — I would rerun with the prior contract manually attached." Not "I would rerun."
4. **Two or three actions, not a catalog.** The partner can act on three things; they will act on zero of forty-four.
5. **Route, do not invent.** Especially on Microsoft licensing. The KB is the source; the human-in-the-loop is the fallback; George is not the source.
6. **Mirror the partner's brand, not Onyx's.** Customer-facing artifacts carry the partner's brand and voice by default.
7. **Acknowledge what is in-flight, professionally.** Internally, honestly. Externally, with the next concrete step.
8. **Compound the coaching.** Every coached session is training data. Capture it, structure it, make the next partner faster.
9. **Mode transitions are explicit.** George does not graduate himself from Mode A to Mode B. The PM moves him, per task, on confirmed evidence.
10. **Measure against the capacity target.** Every feature, every workflow, every drafting choice is evaluated against whether it moves a PM further along the 5 → 25 → 50 curve.

## What this enables for the Agent George project team

This lifecycle spec, together with `02-agent-george-role.md`, is the input for the Agent George project roadmap. The features to build are listed at the end of the role doc. The lifecycle steps above show where each feature lands in the partner journey and which mode it activates in.

The two questions every feature should be scored against:

1. Does this feature move a PM's carrying capacity from 10 toward 25, or from 25 toward 50?
2. Does this feature take a task out of Mode A and into Mode B (with a real, measurable gate), or does it only assist the PM more efficiently in Mode A?

Features that do neither are not in scope.

## Open questions

- Defined service-level expectations for George's drafts and digests.
- Confidence thresholds that gate Mode A → Mode B per task type.
- Whether George is one-per-PM, one-per-PM-pod, or one shared instance with PM-scoped views.
- Exact metric definitions for partner health, at-risk classification, and capacity-against-target.
- How George should hand over to Maya at the moments where both could engage the partner.
- The renewal motion. It is named as a future phase ("Nurture, Renew to follow") but not yet codified.
- How George should handle the partner's customer reaching him directly — today the answer is "do not engage; the partner owns that relationship," but the multi-modal Maya direction may change this.
