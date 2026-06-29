---
type: process
title: Onyx — CSM Onboarding Process
description: How Onyx onboards a newly signed partner from contract to running assessments.
tags: [onboarding, csm, process]
links: [/core/02-agent-george-role.md, /core/03-agent-george-lifecycle-steps.md]
---
# Onyx — CSM Onboarding Process

This file describes how Onyx onboards a new partner and where the value is. The process is **partner-centric**, not end-customer-centric: Onyx onboards the partner (the MSP / CSP), and the partner then runs assessments on their own customers using Transition Hub. The bottleneck is the human coaching layer — a coach can only carry so many active onboardings at once. The work in flight is to lift that cap without losing the coaching quality the partner is buying.

> **How George uses this doc.** This is *descriptive context* — how Onyx onboards partners and what on-track vs at-risk looks like. It is **not a script to march through.** George works fluidly per `core/03-agent-george-lifecycle-steps.md`: read this for background and signals, then decide the next right move for each partner. The flow below is the human motion for reference, not George's checklist.

## Vocabulary

- **Partner.** The MSP / CSP Onyx contracts with. The partner is the buyer.
- **Customer.** The partner's end customer (the enterprise whose tenant gets assessed). Onyx does not onboard the customer; the partner does.
- **Onboarding plan.** A short, partner-specific plan that takes a newly signed partner from contract to "running their first Transition Hub assessment on a real customer." George generates this fluidly per partner — a handful of milestones, not a fixed template.
- **Coach / program manager (PM).** Same role, two names. Owns the partner relationship through coaching and decides when a partner is ready to operate independently.
- **Pilot.** A distributor-funded onboarding where the partner pays nothing for platform access and the deal economics work off the first big win.

## Lifecycle at a glance

The customer-facing arc is **Win → Support → Grow**. From the partner-onboarding side, four stages are observable:

1. **Sign / kickoff** — contract done, partner introduced to their coach, first assessment customer identified.
2. **Activation** — partner-branded portal stood up, first customer's tenant authorized, first assessment runs end-to-end, first scenarios reviewed.
3. **Coaching to confidence** — coach sits with the partner through the first couple of real deals; partner moves from "watching" to "doing."
4. **Independent operation** — partner runs assessments without the coach in the room; coach reviews on cadence, steps in only for non-routine deals.

There is no fixed published duration per stage; the working assumption is that a healthy partner closes their first deal off a Transition Hub assessment within the first big purchasing cycle.

## How onboarding runs (reference flow)

1. **Contract / enrollment.** Partner is signed (directly, or nominated and funded via a distributor pilot).
2. **First call.** Coach walks the partner through what the platform does, what Onyx will and will not do, and asks the partner to nominate the first customer for assessment.
3. **Partner-branded portal stood up.** The partner provides branding so customer-facing artifacts (portal, scenarios) carry the partner's identity, not Onyx's.
4. **First tenant ingest.** Partner sends their end customer an Entra ID app authorization link. The customer's global admin authorizes; Microsoft 365 SKU data and usage trend ingest; CSP readiness checks run.
5. **Assessment review with the coach.** Coach walks the partner through the three scenarios — As-Is, Right-Size, Optimize — plus the Insights (security, productivity, AI adoption, third-party takeout signals). This is the highest-value, highest-friction moment in onboarding.
6. **First customer-facing artifact.** Output is packaged for the partner to take to their customer, in the partner's brand.
7. **Second and third assessments.** Coach steps down from "in every meeting" to "on the readout." Partner starts running ingest themselves.
8. **Steady-state.** Partner operates independently; coach moves to by-exception. Support Hub becomes the partner's go-to for licensing questions on whatever surface is live.

## Artifacts

- **Partner-branded portal** — the customer-facing surface. Branding is captured during activation.
- **Tenant ingest authorization** — Entra ID app link to the partner's customer.
- **Assessment output** — As-Is, Right-Size, Optimize scenarios + Insights, in the partner's brand.
- **Coach notes** — captured as input to George's knowledge layer so the next partner is faster.

> Internal only — do not paraphrase to customers.
> Most partner-facing artifacts ride on the partner's brand, not Onyx's. The platform is white-label by design. Any artifact George produces that touches a customer-of-a-partner defaults to the partner's brand and voice unless explicitly requested otherwise.

## Roles and accountabilities

- **Coach / program manager (PM).** Owns the partner relationship through coaching. Decides when a partner is ready to operate independently. Capacity is the constraint the whole product is built to relax.
- **Sales.** Closes the partner and hands off to the coach.
- **Support / engineering.** Holds the platform; the loop for platform logic issues surfaced during assessments.
- **Customer-side champion (partner side).** Whoever inside the partner owns Microsoft practice growth — typically a founder, VP Sales, or pre-sales lead.
- **Exec sponsor (partner side).** Typically the partner CEO.

## Cadences

- **Active onboarding.** Multiple touchpoints per week during the first one or two assessments; cadence stepped down as the partner gains confidence.
- **Steady state.** Monthly or by-exception once the partner operates independently.

(Default to weekly during active onboarding unless the partner agrees otherwise. See `set_cadence`.)

## On-track vs at-risk signals

### On-track

- Partner nominated a first real customer within the first call.
- Tenant ingest completes cleanly; CSP readiness checks return without manual intervention.
- Partner asks specific questions about scenarios ("why is Optimize lower than Right-Size?"), not general ones ("how do I use this?").
- Partner takes a scenarios export into a customer meeting within the first few weeks.
- Partner's pre-sales person runs the second ingest without the coach in the room.
- Partner moves a customer to a CSP commitment off the first assessment.

### At-risk

- Partner has not named a first customer within the first two weeks.
- Tenant ingest fails, or the partner pushes back on the numbers and the issue is logic, not data.
- A Microsoft-side connection issue blocks partner-side data — flag it, but do not let the partner think it is their fault.
- The coach is still in every meeting beyond the third assessment — the platform is not yet doing the work.
- Partner asks for "more reports" rather than how to win the next deal — an anti-pattern signal.
- Partner stops responding to scheduling within five business days.

## Handoffs

- **Sales → CS.** Whoever closed the partner hands them to the coach with a briefing.
- **Onboarding → steady-state.** Coach declares the partner independent after a couple of coached deals — judgment-based, with "first deal closed off a Transition Hub assessment" as the signal Onyx wants.
- **CSM → Support.** Once in steady state, license questions go to Support Hub; the CSM stays the relationship owner.
- **Engineering escalations.** Assessment logic issues (not data issues) route to the engineering loop.

## Open questions

- Target time-to-first-assessment, if Onyx publishes one internally.
- Default cadence for coach ↔ partner meetings during active onboarding.
- Whether Support Hub gets its own light onboarding motion or rolls into the Transition Hub flow as surfaces consolidate.
