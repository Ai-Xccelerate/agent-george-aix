# Onyx — ICP and Personas

Onyx sells to Microsoft partners, not to end customers. The buyer, the user, and the renewal contact all sit inside the partner. The end customer (the enterprise whose tenant gets ingested) is a downstream stakeholder Onyx never contracts with directly. This file is for George; it pins down who Onyx is for, who Onyx is not for, and the personas George will most often write to or about.

## ICP firmographics

- **Industry / category.** Microsoft partners — specifically MSPs and CSPs. The Onyx customer base today is 95% partners and 5% direct end customers.
- **Profile.** Local Microsoft partners who already provide services (telephony, security, Office 365, managed services) to mid-market and enterprise customers, and want to also win the Microsoft contract underneath those customers. The two examples named in the Arrow pilot are partners on the order of 35 people and 40 CSP customers — "not massive, but want to grow."
- **Geography.** North America today; subsidiaries in the Nordics and South Africa; LATAM, Dubai, and Asia named as next regions. Onyx is multi-region by design; GDPR and multi-region compliance posture is a stated concern of the leadership team and is a known posture gap, not a strength.
- **Tech-stack signals.** Deep Microsoft ecosystem — Microsoft 365, Azure, Microsoft Teams. Customers who would benefit from a Teams-embedded Support Hub or a Copilot agent are ideal users.
- **Buying triggers.**
  - The partner has Enterprise Agreement customers and a "this is your last renewal" letter from Microsoft.
  - The partner is being pushed into CSP by Microsoft but lacks the licensing pre-sales bench to compete with Software One, SHI, CDW on the translation.
  - A distributor (Arrow, Ingram Micro) is funding the partner's pilot — at that point the partner-side budget objection is gone and the only question is execution.
  - The partner has just lost a deal to a larger reseller and traced it back to inability to price the CSP scenarios.

## Anti-ICP

George should be slower to engage, slower to expand, and faster to escalate when the partner looks like one of these:

- **Large scaled resellers** (Software One, SHI, CDW class). They have hundreds of licensing people in-house. Onyx is built to replace that headcount, not to add to it.
- **Pure FinOps / SAM-tool buyers.** Partners or customers shopping for "the tool with the most optimization reports" are not Onyx's market. Onyx is deal-making, not asset management. The signal: they ask "how many reports does it generate?" rather than "how fast can we win the next EA?"
- **Partners with no Microsoft enterprise pipeline.** If the partner does not have EA customers to transition and does not believe they can win one, the platform has nothing to compound on. Onyx does not generate the customer; it equips the partner to win one.
- **Partners who want a 200-person licensing team to talk to**, not a platform. The "agent boss" mindset is part of the fit — partners who are not willing to put a platform to work will not get the leverage.
- **Customers asking Onyx to build their own dashboard / portal / 44 reports.** Pulls Onyx off-strategy; named explicitly as something to refuse.

## Buyer personas (partner side)

### Partner CEO / Founder

- **What they want.** A platform that lets their sales team go after EA-to-CSP business they could not previously win. Co-op funding from a distributor (Arrow / Ingram) when available so the platform pays for itself out of the first deal.
- **KPIs they are measured on.** New Microsoft contract revenue won, CSP customer count, partner-tier movement with Microsoft.
- **Objections.** "We do not have the licensing people to support more CSP customers" (answer: Support Hub). "We cannot price a CSP deal competitively" (answer: Transition Hub). "I do not want another tool my team will not use" (answer: the coach is included; partners win >50% of proposals they run on the platform).
- **Vocabulary.** CSP, EA, level-A / level-B customers, MVF, co-op, partner tier, GTM, pipeline, "land and expand."
- **What makes them say yes.** A specific dollar number on a specific named customer — "Here is a $900K EA in your pipeline; here are the three scenarios; here is the funding the partner is eligible for."

### Partner sales engineer / pre-sales

- **What they want.** The right-size and optimize numbers, fast, and confidence those numbers will hold up in front of the customer. The Maya in-app coach when they hit a workflow step they have not done before.
- **KPIs.** Proposals shipped, win rate on proposals shipped, time-to-proposal.
- **Objections.** "The numbers look wrong" (most common; usually a data ingest or contract-parse issue, not logic). "I do not trust an AI tool on Microsoft licensing" — this is what Support Hub's PhD-grade KB and human-in-the-loop are for.
- **Vocabulary.** Tenant, Entra ID, 24 workloads, SKU, E5, Defender, CSP readiness checks, reserved instances.
- **What makes them say yes.** A clean assessment they could not have produced by hand, in a fraction of the time, with insights they did not already see.

### Partner account manager (AM)

- **What they want.** A scenario they can take to their customer and lead with. A persona-tailored view of the data — not the raw 24-workload table, but the language the AM uses in a customer meeting.
- **KPIs.** Deals closed, customer renewals, cross-sell motion.
- **Objections.** "I do not want to learn another tool." Answer: Maya as in-app coach; the platform should meet them in Teams / Copilot / email rather than force a new portal habit.
- **Vocabulary.** Customer, pipeline, win, close, renewal, QBR.
- **What makes them say yes.** A version of the assessment that makes them look like a Microsoft expert in front of the customer.

## End-user personas (the partner's customer)

George does not own the relationship with the end customer — the partner does. But George reads and drafts content that ends up in front of them, so he needs to know how they read.

### Customer CIO

- Cares about technology fit, security posture, AI readiness, "am I in the right contract structure for the next two years."
- Wants the insights view of Transition Hub: security score, productivity, AI adoption, competitive-takeout signals (e.g., "you have CrowdStrike but already pay for Defender via E5").
- Vocabulary: tenant, workloads, identity, Defender, Copilot, "technical debt."

### Customer CFO

- Cares about the dollar number first, the explanation second.
- Wants As-Is vs Right-Size vs Optimize as three commercial options, with a clear "this saves X, this is the partner's services package, this is the net."
- Vocabulary: TCO, OpEx vs CapEx, renewal, three-year, savings, incentive.

### Customer IT admin

- Cares about whether the change is safe, who is going to actually do the work, and whether they can keep working while it happens.
- Wants prescriptive steps: "click here, drop this in." This is precisely the gap Maya as in-app coach is being built to close.
- Vocabulary: global admin, tenant ID, license assignment, group policy.

## Day in the life — snippets

### Partner CEO

It is Monday morning. The CEO has three EA customers whose renewals fall in the next 90 days and a fourth where Microsoft has hinted at non-renewal. They have already lost one to Software One last quarter. Today they need to look at the pipeline with their VP Sales and decide which two get worked hard this month. They open the Onyx portal because they want to see, at a glance, which of the four has the best Transition Hub assessment. If the answer is not on one screen, they will go back to spreadsheets.

### Partner sales engineer / pre-sales

A new customer's tenant came in over the weekend. The SE opens Transition Hub Monday morning, watches the ingest finish, and starts validating the As-Is reconstruction. They notice the right-size number looks low; they suspect a parsed-contract pricing-tier issue. They want to escalate, but not in a way that loses the week. They click Maya, ask "how do I flag a contract-parse issue," and expect a one-line answer.

### Partner account manager

The AM has a customer meeting Wednesday. They print the scenarios deck, but the deck is a generic PDF and they have to retype half of it into their own slide template to make it presentable. They wish the output were either branded for them or a live link they could share. They will say so to their CSM if asked; otherwise they will live with it.

### Customer IT admin

The customer's IT admin gets an email from their partner: "Please authorize this Entra ID app for our Microsoft licensing assessment." They have no context on Onyx. They forward the email to their security person, get cleared, click the link, and want to never think about it again. If the next email they receive is "we found $80K of unused E5 — here is the partner's quote to action it," they are happy. If it is "we have generated 44 optimization reports," they delete it.

## Open questions

- Whether Onyx targets a specific partner-size band (revenue / headcount thresholds) or treats "local Microsoft partner with EA customers" as the only screen.
- Named distributor relationships beyond Arrow and Ingram Micro that should count as "in ICP" signals.
- How Onyx talks about partners in regulated verticals (healthcare, public sector) where the EA → CSP shift behaves differently.
- Whether the Microsoft CRO add-on is sold to a specific persona inside the partner (CEO vs VP Sales).
- The right way for George to refer to "the partner's customer" without being clunky — internal shorthand has not been settled.
