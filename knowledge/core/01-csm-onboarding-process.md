# Onyx — CSM Onboarding Process

This file describes how Onyx onboards a new partner today and where the motion is changing. The process is **partner-centric**, not end-customer-centric: Onyx onboards the partner (the MSP / CSP), and the partner then runs assessments on their own customers using Transition Hub. The current bottleneck is the human coaching layer — one Fraser onboarding ~10 partners a month is the cap. The work in flight is to lift that cap without losing the coaching quality the partner is buying.

## Vocabulary

- **Partner.** The MSP / CSP Onyx contracts with. Synonyms used loosely in transcripts: "account," "customer," "the partner." For this file, **partner** is the only correct term.
- **Customer.** The partner's end customer (the enterprise whose tenant gets ingested). Onyx does not onboard the customer; the partner does.
- **Onboarding plan.** The set of steps required to take a newly signed partner from contract to "running their first Transition Hub assessment on a real customer." Today this exists in flow form (Dean documented it) but is not yet codified as a single artifact.
- **Step.** A single discrete unit inside the onboarding plan (e.g., "partner authorizes their first customer's tenant via Entra ID").
- **Owner.** The Onyx person accountable for a step. Today, almost always Fraser, Stuart, Navash, or Jen.
- **Coach / program manager (PM).** Same role, two names. Fraser is the canonical coach; Stuart is the named deal-maker coach; Jen is pivoting to full-time PM; Navash has been doing Support Hub onboarding and is being considered for a Transition Hub PM track.
- **Pilot.** An Arrow- or distributor-funded onboarding where the partner pays nothing for platform access and the deal economics work off the first big EA win.

## Lifecycle at a glance

The customer-facing arc is **Win → Support → Grow**, with Nurture and Renew named as future phases. From the partner-onboarding side, four phases are observable in the current motion:

1. **Sign / kickoff** — contract done, partner introduced to their coach, first assessment customer identified.
2. **Activation** — partner-branded portal stood up, first customer's tenant authorized, first assessment runs end-to-end, first scenarios reviewed.
3. **Coaching to confidence** — coach (Fraser / Stuart) sits with the partner through 2–3 real deals; partner moves from "watching" to "doing." Today's reality: this takes weeks, not days.
4. **Independent operation** — partner runs assessments without the coach in the room; coach reviews on cadence, jumps in only for non-routine deals.

There is no fixed published duration for each phase yet — the working assumption inside Onyx is that "if it is going well, a partner is closing their first deal off a Transition Hub assessment within the first big EA cycle." The Arrow pilot is the first scaled test.

## How onboarding actually runs today

Stated honestly and post-Seattle workshop:

1. **Contract / pilot enrollment.** For Arrow pilot partners, Arrow nominates the partner and confirms funding; for non-Arrow partners, Onyx signs them directly on the flat platform license. Booking is via John's calendar today for distributor-routed partners.
2. **First call.** Coach (Fraser, today) walks the partner through what the platform does, what Onyx will and will not do, and asks the partner to nominate the first customer for assessment.
3. **Partner-branded portal stood up.** The partner provides branding so the customer-facing artifacts (portal, scenarios) carry the partner's identity, not Onyx's.
4. **First tenant ingest.** Partner sends their end customer an Entra ID app authorization link. Customer's global admin authorizes; M365 SKU data and Azure 12-month trend ingest; CSP readiness checks run (quotas, marketplace, reserved instances).
5. **Assessment review with the coach.** Coach sits with the partner and walks them through the three scenarios — As-Is, Right-Size, Optimize — plus the Insights (security score, productivity, AI adoption, third-party takeout signals). Today this is the highest-value, highest-friction moment in the onboarding because the platform is "a little buggy" and the partner needs the coach to read the data.
6. **First customer-facing artifact.** Output is exported (today: PDF) for the partner to take to their customer. Partners want PowerPoint or a branded live link; the team's stated direction is a branded live link.
7. **Second and third assessments.** Coach drops their time on the partner from "in every meeting" to "on the readout." Partner starts running ingest themselves; coach reviews the scenarios.
8. **Steady-state.** Partner operates independently; coach moves to monthly or by-exception. Support Hub becomes the partner's go-to for licensing questions, today via the web chat (and over time via Teams, Copilot, shared inbox, and email).

What this looks like in current pipeline reality: Transition Hub onboardings are oversubscribed ("we can't close them"). Support Hub has three to four closed customers and no pipeline backlog.

## Artifacts

- **Partner-branded portal** — the customer-facing surface. Branding is captured during activation.
- **Tenant ingest authorization** — Entra ID app link to the partner's customer.
- **Assessment output** — As-Is, Right-Size, Optimize scenarios + Insights. Today: PDF export. Target: branded live link. PowerPoint is the partner-requested fallback.
- **Documented onboarding flow** — Dean documented the current flows. Not located in this source pack; treat as authoritative once found.
- **Coach notes** — today informal; the new motion will codify them as input to a PM agent.

> Internal only — do not paraphrase to customers.
> Most partner-facing artifacts ride on the partner's brand, not Onyx's. The platform is white-label by design. Any artifact George produces that touches a customer-of-a-partner should default to the partner's brand and the partner's voice unless explicitly requested otherwise.

## Roles and accountabilities

- **Coach / program manager (Fraser today, Jen pivoting, Navash candidate).** Owns the partner relationship through coaching. Decides when a partner is ready to operate independently. Currently caps at roughly 10 active onboardings each.
- **Stuart** — deal-maker coach. The named expert Onyx pitches as "you also get this person." Used selectively on harder partner deals.
- **Navash** — has been the Support Hub onboarding lead; operations-leaning background. Being assessed for a Transition Hub PM role pending her own appetite.
- **Jen** — pivoting to 100% PM, reporting to Fraser, with an agent assist on the way. Coming off Support Hub onboarding cover.
- **James** — moving off PM, back to selling.
- **Support / engineering.** The Surfe team (Esteban, Argentina) holds the platform. Esteban has a proposed architecture and is being given two weeks to bring it to life with DevOps observation.
- **Customer-side champion (partner side).** Whoever inside the partner owns Microsoft practice growth — typically the founder, VP Sales, or a designated pre-sales lead.
- **Exec sponsor (partner side).** Typically the partner CEO.

## Cadences

- **Active onboarding.** Multiple touchpoints per week during the first one or two assessments; cadence stepped down as the partner gains confidence.
- **Arrow pilot kickoff.** Seven partner meetings being booked the week following the workshop; Arrow team books direct via John's calendar. Tom Harshberg's stated rule: "I am here for advice; I am not a gate to get anything done."
- **Joint Arrow ↔ Onyx coordination.** Laurie (Arrow) is setting up a Teams channel for joint discussion.
- **Internal Onyx cadence.** Coaches sync with Fraser; Fraser syncs with John, Chris, Neil. No formal repeating cadence has been published in this source pack — assume weekly until told otherwise.

## On-track vs at-risk signals

### On-track

- Partner has nominated a first real customer within the first call.
- Tenant ingest completes cleanly; CSP readiness checks return without manual intervention.
- Partner asks specific questions about scenarios ("why is the Optimize number lower than Right-Size?"), not general questions ("how do I use this?").
- Partner takes a scenarios export into a customer meeting within the first two to three weeks.
- Partner's pre-sales person starts running the second ingest without the coach in the room.
- Partner moves a customer to a CSP commitment off the first assessment.

### At-risk

- Partner has not named a first customer within the first two weeks.
- Tenant ingest fails or returns numbers that the partner pushes back on ("right-size looks wrong"), and the issue is logic, not data.
- Partner-Center connection issue blocks partner-side incentive data (this is a known Microsoft-side outage, not partner fault — flag it but do not let the partner think it is them).
- The coach is in every meeting beyond the third assessment — that means the platform is not yet doing the work.
- Partner is asking for "more reports" rather than asking how to win the next deal — this is an anti-pattern signal.
- Partner stops responding to scheduling within five business days.

## Handoffs

- **Sales → CS.** Today, John (or whoever closed the partner) hands the partner to Fraser. There is no formalized handoff packet yet beyond a verbal briefing; codifying this is part of the post-workshop work.
- **Onboarding → steady-state.** Coach declares the partner independent after two or three coached deals. This is judgment-based today, not metric-gated. The metric Onyx wants is "first deal closed off a Transition Hub assessment."
- **CSM → Support.** Once the partner is in steady state, license questions go into Support Hub (today: web chat; soon: Teams agent, Copilot agent, shared inbox, email). The CSM stays the relationship owner; Support Hub answers the queries.
- **Engineering escalations.** If an assessment surfaces a logic issue (not a data issue), Esteban + Fraser are the loop. DevOps observation is being added in the two-week architecture sprint.

## What has changed recently and why

George must not reference the older motion. The current state, as of the May 13–14 Seattle workshop:

- **Sales Hub is parked.** Do not mention Sales Hub as an active product in any onboarding conversation.
- **Support Hub is being simplified.** The web chat stays, but the strategic surfaces are Microsoft Teams (agent in the marketplace), Copilot, shared inbox, and email. "Take this to where the users live" is the explicit direction. Do not promise the partner a separate Support Hub portal as the primary experience.
- **PM roles are being reshuffled.** James is off PM. Jen is moving to 100% PM under Fraser with agent assistance. Navash is being assessed for a Transition Hub PM role. Do not refer to anyone by their pre-workshop role.
- **2.0 is being defined as "automated onboarding + PM agents + hardened Transition Hub on Azure."** Not a clean-room rebuild; not a 44-reports tool. If a partner asks "what is 2.0?" the honest answer is: faster scale onto more partners without losing coaching quality.
- **The platform is being moved to Azure end-to-end.** Replit was the prototype layer; production is Azure. Do not reference Replit when describing where the platform runs.
- **Coupling between marketing site and product is being broken.** The marketing site is moving to Vercel under Megan's ownership. Do not link partners to the product app from marketing pages until the decoupling is done.

## Open questions

- Where the canonical onboarding-flow document lives (Dean documented it; pack does not include it).
- Whether there is a target time-to-first-assessment Onyx is publishing internally.
- Default cadence for coach ↔ partner meetings during active onboarding.
- Named exec sponsor on Onyx side for each tier of partner (Arrow-pilot vs direct).
- Status today of the Partner Center API connection (known broken on Microsoft side as of the workshop).
- Whether Support Hub gets its own light onboarding motion (Navash's current role) or rolls into the Transition Hub flow once the surfaces collapse onto Teams / Copilot / email.
