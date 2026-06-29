---
type: reference
title: Onyx — Product Overview
description: Transition Hub, Support Hub, and the platform George supports.
tags: [product, transition-hub, support-hub]
links: [/core/10-company-overview.md]
---
# Onyx — Product Overview

Onyx is a platform for Microsoft partners. It runs the assessments and licensing analysis that a partner needs to win an Enterprise Agreement to CSP transition, and it answers the licensing questions that arrive once the customer is on. The platform is delivered to the partner as partner-branded software; the partner's customers experience it as the partner's tool, not as Onyx. A human "coach" (program manager) sits on top of the platform to teach partners how to use it well.

## What Onyx is

One platform with three apps:

- **Transition Hub** — the lead product. Helps a partner price, scenario-model, and win an enterprise customer's move from Enterprise Agreement (EA) to Cloud Solution Provider (CSP).
- **Support Hub** (internal codename MAIA) — the original product. A licensing-Q&A surface with a curated, PhD-level Microsoft licensing knowledge base and a human-in-the-loop fallback. Partner-branded; customer-facing and sales-team-facing.
- **Sales Hub** — concept stage; explicitly parked. Same engine pointed at cross-sell and upsell inside existing customers; will be revisited after Transition Hub 2.0 ships.

A fourth surface, **Maya**, is the in-app coach/avatar that lives across the apps. Today she is a thin entry point inside Transition Hub. The roadmap turns her into a multilingual, multimodal coach who can answer usability questions in-app (and, over time, knowledge and subject-matter questions).

## Core modules

### Transition Hub

**What it does.** Connects to the customer's Microsoft 365 and Azure tenant via an Entra ID app authorization, ingests licensing and usage data, pairs it with Microsoft programs/incentives and the partner's own price list and services catalog, and outputs three commercial scenarios for the partner to take to the customer: **As-Is** (current contract reconstructed), **Right-Size** (remove unassigned / inactive licenses, 90-day inactivity rule), and **Optimize** (check 24 Microsoft workloads, swap to lesser license if the user does not need premium features). It also produces insights — security score, productivity, AI readiness, third-party competitive-takeout signals (CrowdStrike, Okta, etc.) — and surfaces Microsoft funding the partner is eligible for.

**Who uses it.** The partner — typically the partner's account manager and sales engineer / pre-sales. The customer's IT admin authorizes the tenant ingest, but the customer is not the daily user.

**Why it matters.** Without Transition Hub, the partner must do this analysis by hand or hand it to a larger reseller who then owns the customer. With Transition Hub, the partner can lead the assessment at T-6 or T-12 months and "reset the playing field" before the legacy reseller can. Partners on the platform have a >50% win rate today.

### Support Hub (MAIA)

**What it does.** Chat-interface (today; multi-surface tomorrow) over a curated Microsoft licensing knowledge base. Answers licensing questions for the partner's people and the partner's customers, with a human licensing expert behind it as the human-in-the-loop fallback. Partner-branded.

**Who uses it.** The partner's sales team (questions that come up in deal cycles) and the partner's customers (post-sale licensing questions). Today it runs as a website; the direction is to publish the same answers into Microsoft Teams as an agent, into Copilot, into a shared inbox, and over plain email — meeting users where they already are.

**Why it matters.** Onyx's pitch to the partner is: "Sell more CSP without hiring 200 licensing people." Support Hub is the scalable replacement for that headcount. Accuracy is the work-in-progress.

### Sales Hub

Concept only. Will pair the same data with cross-sell and upsell triggers (e.g., partner incentives plus customer-side signals to recommend the right next workload). Parked today; Transition Hub gets the resources.

### Maya

Today: an avatar/button in Transition Hub. Tomorrow: an in-app voice and vision coach who can see what the user sees and walk them through it ("click the second button, take this link, drop the tenant ID here"). Same avatar across hubs; switches modes/colors per app. Multilingual rollout planned, including French — seven languages named as the target band.

## How it fits in a customer's stack

Onyx is bought by the partner, not the end customer. For the partner, Onyx replaces:

- A pre-sales licensing team they cannot afford to hire (the role Software One staffs with hundreds of people).
- A consulting workflow that today is manual: copy the contract, add an add-on, propose a premium SKU.
- A help desk for L1 licensing questions, today either unstaffed or staffed by a "shared inbox" of internal experts.

Onyx complements: the partner's existing CRM, their relationship with the customer, their service delivery, and their existing Microsoft distributor relationships (Arrow, Ingram Micro). It is not a replacement for the partner's account team — it is leverage for it.

For the partner's end customer, the platform sits inside the licensing/procurement workflow: ingest tenant → produce scenarios → close the EA → CSP transition. Beyond Microsoft, the framework is intended to apply later to other vendors (Cisco, IBM, Oracle named); that is a future direction, not a current capability.

## Architecture in plain English

Onyx runs on Azure with container-based services (Azure-managed scaling, no Kubernetes today). There are four core pieces:

- **Admin panel** — internal management UI.
- **Support Hub frontend (MAIA)** — the customer-facing query UI.
- **Backend** — access control, user and document management, vector database orchestration.
- **AI container** — a FastAPI app that handles retrieval-augmented generation, search (Cohere), model calls, and tracing via LangSmith. ChromaDB lives inside this container.

Data flow runs Azure Front Door → DNS → frontend → backend. Files sit on S3; metadata on MongoDB. Some third-party services (e.g., Resend) are being migrated to Azure-native equivalents to reduce latency.

The Support Hub ingestion pipeline uses LlamaParse for PDF and Word (tuned for tables), direct ingest for CSV, and Trafilatura → Markdown for web URLs. Everything lands in ChromaDB.

Transition Hub was built in Replit originally and is being moved into the same Azure environment. It is **not yet connected to the Support Hub vector DB or AI container** — today its logic is mostly rule-based. The plan is to merge the tenant databases between Support and Transition Hubs and, eventually, share the knowledge layer.

Deployment model: the partner gets a partner-branded portal. The customer's global admin clicks an Entra ID app link, which authorizes Onyx to read the M365 and Azure tenant. Outputs today are exported as PDF; partners want PowerPoint or a branded live link — the team's intent is to move to a branded live link.

## What Onyx is **not**

- **Not a software asset management or FinOps tool.** Surveil, Flexera, and similar tools optimize software estates and reserved instances for customers who have a FinOps team to act on the reports. Onyx is **deal-making, practice-building deal-making.** Optimization is a side-effect of the deal, not the reason for being.
  > "Their reason for being is to look at software estate, FinOps, optimize reserved instances… ours is basically we're deal-making, practice-building deal-making." — Fraser
- **Not a 44-reports tool.** Partners and partners' customers do not have people to read 44 optimization reports. Onyx is "really laser-focused" on the two or three actions that close the deal. More reports is an anti-pattern.
- **Not a competitor to the big scaled resellers** in the way partners assume. The bet is that the local Microsoft partner — already trusted on services — wins the Microsoft contract too, because the platform replaces the licensing headcount they would otherwise need.
- **Not a chatbot or a generic AI assistant.** Support Hub is a knowledge product with a human-in-the-loop. Maya is a coach, not a chatbot.
- **Not yet multi-vendor.** Cisco, IBM, Oracle are aspirational direction. Today everything is Microsoft.

## Vocabulary

- **Partner** — Onyx's customer. A Microsoft MSP or CSP. The buyer and the user of the platform.
- **Customer** — the partner's end customer (the enterprise whose tenant the partner is assessing). Onyx rarely contracts with the customer directly.
- **CSP** — Cloud Solution Provider, Microsoft's licensing program partners resell under today.
- **EA** — Enterprise Agreement, Microsoft's legacy direct-contract licensing program. The "EA → CSP transition" is the macro shift Onyx rides.
- **LAR / LSP** — legacy reseller categories Microsoft is winding down. "This is your last renewal" is how Microsoft is telling LAR customers to move.
- **Transition Hub / Transition Engine / CSP Growth Engine** — same product, naming has drifted; canonical today is Transition Hub.
- **Support Hub / MAIA** — the licensing Q&A product. Maya the in-app avatar is a separate thing from MAIA the backend.
- **As-Is / Right-Size / Optimize** — the three scenarios Transition Hub generates for every assessment.
- **Insights** — non-pricing signals Transition Hub surfaces: security score, productivity, AI readiness, competitive-takeout opportunities.
- **Coach / program manager (PM)** — the human Onyx employee who teaches a partner how to use the platform. Today: Fraser, Stuart, Jen, Navash. The coaching layer is the current scaling bottleneck.
- **Partner Center API** — Microsoft API Onyx uses for partner-side data (specializations, incentives). Connection is currently broken on Microsoft's side.
- **Maya** — the in-app coach avatar across hubs.
- **Win → Support → Grow** — the platform tagline, mapping to Transition Hub (Win), Support Hub (Support), Sales Hub / future (Grow). Nurture and Renew are named as next phases.

## Open questions

- Definitive product naming Onyx wants externally — "Transition Hub" vs "CSP Growth Engine" vs "Transition Engine" all appear in internal conversations.
- Which integrations beyond Microsoft 365, Azure, and Partner Center are live today (the Partner Center connection is currently broken).
- Current public version numbers George should reference for each hub.
- Whether Maya, MAIA, and Support Hub should be presented as one product or three to partners.
- Where the canonical product documentation lives (Dean's flows were referenced but not located in this source pack).
