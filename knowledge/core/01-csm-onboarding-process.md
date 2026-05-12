# CSM Onboarding Process & Role

This document captures how onboarding works today at Onyx (pre–Agent George), the artifacts involved, and the ongoing role of the Customer Success Manager (CSM).

## Vocabulary

- **Partner**: An MSP (Managed Service Provider) that signs a contract with Onyx.
- **Partner Admin**: The primary administrator at the partner who manages the contract and users on the Onyx platform.
- **Partner Internal Users**: Employees of the partner (typically sales, pre-sales, licensing) who use the platform.
- **End Customer**: A customer of the partner who gets access to the platform through the partner.
- **Support Hub**: The Onyx product where CSP partners and customers are administered.
- **Partner Control Panel**: The partner-admin–facing portion of the Support Hub.
- **Transition Hub / Sales Hub**: Other Onyx hubs included in the full CSP Growth Engine solution.
- **Onboarding Hub**: The ValueCase-backed space used to track onboarding tasks with the partner. (Domain will migrate from ValueCase to a getonyx subdomain.)
- **Maya**: The current avatar/name for the support bot inside the Support Hub.

## Two Customer Journeys

1. **Journey A — Partner Onboarding**: Onboarding a new MSP/partner onto the Onyx platform.
2. **Journey B — End Customer Onboarding**: The partner onboards one of their customers through Onyx.

Journey B can only begin after the partner admin and internal users of Journey A are set up.

## Pre-Onboarding (Sales-Driven)

Before any platform setup occurs, the salesperson collects signed documents:

1. **NDA** — signed via Zoho Sign. Required for both trial and production engagements.
2. **Contract** — signed via Zoho Sign (production engagements).
3. **Order Form** — a simple document capturing:
   - Contract term (typically 3 years)
   - Pricing total
   - Billing cadence (monthly / quarterly / yearly)
   - Whether a Program Manager is included (full CSP Growth Engine solution)
   - Solution scope

The salesperson forwards the NDA, contract, and order form to the CSM. The CSM stores them and creates a ValueCase space for the partner.

## Kickoff / Onboarding Call

Run by the salesperson + CSM together with the partner.

- Introductions
- Confirm what was purchased
- Identify the **Partner Admin** (the person who will administer the contract)
  - Sometimes the admin is on the call; sometimes the signer names them afterward
  - Onyx tends to deal with senior people on this call; the actual admin may be delegated later
- Walk through the Onboarding Hub (ValueCase space)
- Agree on a **Start Date** (90% of the time this is the day of the onboarding call)
- Agree on cadence for ongoing calls (weekly / biweekly / monthly)
- Agree on an onboarding timeline (2 weeks to 3 months, depending on scope and whether end customers are included)

The CSM does not configure anything in the Support Hub until after this call.

## Onboarding Hub Task List

The Onboarding Hub (ValueCase) is the single source of truth for the onboarding plan. Each task has a target date and is ticked off as completed. Currently the hub bundles Support Hub, Transition Hub, and Sales Hub onboarding together; it will be split per hub.

### 1. Contract & Commercial Setup
- **Contract Signed** — always pre-ticked (gate to enter the hub).
- **Supplier Onboarding** — partner sets up Onyx as a supplier in their systems.
- **Partner Onboarding for Invoicing** — partner provides finance/AP contacts so Onyx can bill correctly. Passed to Onyx finance.
- **Funding & Co-op Guide** — a standard ~8-page document Onyx provides explaining how the partner can claim Microsoft co-op funding to offset the price. Partner files the Statement of Work with Microsoft; Onyx sales / Program Manager (Fraser, James) help draft the SOW. Only available to partners (not end customers).
- **Start Date** — recorded in the hub.

### 2. Partner Admin Onboarding *(blocking gate)*

No other onboarding can proceed until the partner admin account exists, because all other users are added under that admin.

- **Admin User Data Collection** in the hub. Required fields:
  - First name, last name
  - Email address
  - **Domain** (used to scope the customer's login URL, e.g. `partnername.getonyx.ai`)
  - Contact email address visible to that partner's customers on the login page
  - Contact phone (likely to be removed — rarely used)
- **Create the admin** in Support Hub → CSP Partner Management → "Add CSP Partner".
- Admin receives a verification email. Status flips from "Email Verification Pending" → "Active".
- **User Admin Login Created and Issued** — ticked in the hub.
- **Partner Center Link Connection** — handled by the Program Manager for the Transition Hub (when included).
- **Admin Onboarding & Training** — short (~10 minute) walkthrough of the Partner Control Panel. Sometimes done in the kickoff call, sometimes scheduled separately depending on time and audience seniority. Onyx has a short recording of the Partner Control Panel walkthrough that can be reused.

### 3. Partner Internal User Onboarding

- **Awareness Communication for Partner Users** — Onyx provides a templated message (newsletter / email) the partner can send internally explaining what was purchased and why. Use is at the partner admin's discretion. Some partners invite Onyx to their weekly team call to do a short live intro + demo instead.
- **Data Collection** — list of internal users (typical range: 5–35 per partner, depending on size).
- **User Creation** — either:
  - Onyx adds them via Support Hub → CSP Customer Management → "Add CSP Customer", aligned to that partner; or
  - The partner admin adds them via the Partner Control Panel. Today, partner-side additions land in a **Pending Request List** that Onyx must accept. This approval step is planned to be removed (auto-accept), with a 6- and 12-month true-up to reconcile user counts and billing.
  - Bulk import via a master spreadsheet is being built (back-end team will load).
- **Partner User Logins Created and Issued** — ticked in the hub.
- **Partner User Enablement** — sometimes a short demo on the partner's weekly call.

### 4. End Customer Onboarding (Journey B)

Mechanically the same as partner internal user onboarding, with these differences:

- **Audience is different**: end customers (not partner employees).
- **Awareness Communication** is a separate, end-customer–oriented template.
- **User counts are smaller**: typically 1–5 per end customer.
- **Only the partner admin (or Onyx) can add end customer users.** Partner internal users (e.g. sales) cannot.
- **End Customer Webinar** — typically handled by the partner admin or their internal user; Onyx will help when asked.

### 5. Success Sprint (Post-Onboarding)

For the full CSP Growth Engine solution, structured check-ins at:
- 30 days
- 60 days
- 90 days

## Ongoing CSM Role

After onboarding, the CSM owns the ongoing relationship with the partner admin.

### Cadence Calls
- Frequency negotiated per partner (weekly, biweekly, monthly).
- Cadence is **only on calendars today** — not captured in ValueCase or anywhere structured.

### Utilization & QA Reporting (Manual Today)
Prepared for every cadence call. Indu (QA lead) collects:
- Total number of users
- Total number of messages
- Total number of flags
- Total number of recalls
- Out-of-scope question breakdown (categorized manually — operational, etc.)

These numbers are pasted into a PowerPoint template per partner and walked through on the call.

### Question / Flag Handling
Two intake mechanisms today:
1. **Shared QA mailbox** in Outlook — receives notifications when the bot cannot answer a question. Indu's QA team reviews the question, retries Maya with a rephrasing, or composes an answer, then replies to the user. Older interactions were resolved over email.
2. **Flag Management screen** in the Support Hub — when a user flags an in-app answer for more information, it lands here. Replies are now sent from this screen (no longer email).

### Communication Channels with Partners
- ~90% via email
- ~10% via Microsoft Teams (used for urgent issues)
- Most partners are in NorAm; CSM in a different timezone

### Who Reaches Out to the CSM
- **~90% partner admin.** Typical reasons:
  - Forgot how to add a user
  - Has a spreadsheet of users they want bulk-added
  - Question about the Partner Control Panel (admin side)
  - Cannot see expected data / users
- Partner internal users rarely reach out directly.
- End customers reach out to **the partner first** (their salesperson, pre-sales, or licensing team). They only contact Onyx when responding to a flag follow-up.

### Backup / Coverage
- Jen and Indu cover CSM duties (calls, onboarding admin) when the primary CSM is unavailable.
- Sales (e.g. John, Stu, Anil, Chris, James) remain available to support the partner relationship.

## Pain Points (Today)

- Cadence and meeting schedules live only in calendars, not in any structured system.
- Utilization stats are pulled manually from the platform.
- Out-of-scope question categorization is manual.
- Reporting decks are manually copy-pasted per partner.
- Bulk user add is not yet supported in the UI.
- Partner-added users require manual approval in a Pending Request List.
- No chatbot inside the Partner Control Panel today — every admin question routes to the CSM by email.
