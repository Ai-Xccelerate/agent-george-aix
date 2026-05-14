-- =====================================================================
-- Demo seed — fictitious partners + end customers + onboarding plans
-- + simulated chat conversations.
--
-- Idempotent: every row uses a fixed UUID under the 11111111-1111-1111-8111-…
-- namespace, so re-running this file replaces the fixtures cleanly.
-- ALL data is scoped to the Onyx org (00000000-…-0001).
--
-- Usage:  pnpm db:migrate supabase/seeds/demo_customers.sql
--
-- To wipe the fixtures (without re-seeding), run:
--   delete from public.customers where id::text like '11111111-1111-1111-8111-%';
-- (cascades clean up contacts, contracts, plans, steps, health, sessions.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Reset: remove any prior run of this seed. Cascades take care of
-- contacts / contracts / onboarding_plans / onboarding_steps /
-- customer_health / agent_sessions / agent_messages because they all
-- carry on-delete-cascade FKs back to customers (and sessions in turn).
-- End customers are deleted first to satisfy the parent FK.
-- ---------------------------------------------------------------------
-- Wipe end customers first (FK to partners), then partners. We match BOTH
-- the new variant-correct namespace (8111) and any prior run that used the
-- invalid-variant 1111 prefix — Postgres accepted those but Zod uuid
-- validation in the agent's tool layer rejects them, so we need them gone.
delete from public.customers
 where (id::text like '11111111-1111-1111-8111-0000000000__'
     or id::text like '11111111-1111-1111-1111-0000000000__')
   and parent_customer_id is not null;
delete from public.customers
 where id::text like '11111111-1111-1111-8111-0000000000__'
    or id::text like '11111111-1111-1111-1111-0000000000__';

-- =====================================================================
-- PARTNERS (Journey A — Onyx's direct customers)
-- =====================================================================

-- ---- 1) Helix Cloud — GREEN, on track ------------------------------
insert into public.customers
  (id, org_id, name, domain, lifecycle, customer_kind, industry, size, notes)
values
  ('11111111-1111-1111-8111-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'Helix Cloud', 'helixcloud.example', 'onboarding', 'partner',
   'Managed Services', '50-200',
   'Mid-market MSP, AWS-focused. Strong technical bench. Kickoff went smoothly, on track for week-4 first-value.');

insert into public.contacts
  (id, customer_id, full_name, title, email, phone, is_primary, timezone, notes)
values
  ('11111111-1111-1111-8111-000000000101',
   '11111111-1111-1111-8111-000000000001',
   'Priya Shah', 'VP of Operations', 'priya.shah@helixcloud.example',
   '+1-415-555-0142', true, 'America/Los_Angeles',
   'Decision maker. Prefers async, replies fast in the morning.'),
  ('11111111-1111-1111-8111-000000000102',
   '11111111-1111-1111-8111-000000000001',
   'Marcus Chen', 'Lead Cloud Engineer', 'marcus.chen@helixcloud.example',
   null, false, 'America/Los_Angeles',
   'Owns technical setup on Helix side.');

insert into public.contracts
  (id, customer_id, status, start_date, end_date, arr_cents, currency, signed_at, summary, metadata)
values
  ('11111111-1111-1111-8111-000000000201',
   '11111111-1111-1111-8111-000000000001',
   'active', '2026-04-15', '2027-04-14', 9600000, 'USD', '2026-04-12 16:30:00+00',
   '1-year Helix Cloud → Onyx partner agreement. 12 seats, white-label enabled.',
   '{"seats": 12, "tier": "partner-pro", "white_label": true}'::jsonb);

insert into public.onboarding_plans
  (id, customer_id, status, start_date, target_end_date, pace, notes)
values
  ('11111111-1111-1111-8111-000000000301',
   '11111111-1111-1111-8111-000000000001',
   'in_progress', '2026-04-16', '2026-06-11', 'standard',
   'Standard 8-week plan. Tracking on time. Kickoff complete, technical setup underway.');

insert into public.onboarding_steps
  (id, plan_id, customer_id, ordinal, title, status, due_date, completed_at, owner)
values
  ('11111111-1111-1111-8111-000000000401', '11111111-1111-1111-8111-000000000301', '11111111-1111-1111-8111-000000000001',
   1, 'Contract countersigned',          'completed',   '2026-04-15', '2026-04-15 17:00+00', 'george'),
  ('11111111-1111-1111-8111-000000000402', '11111111-1111-1111-8111-000000000301', '11111111-1111-1111-8111-000000000001',
   2, 'Kickoff scheduled',                'completed',   '2026-04-22', '2026-04-20 14:00+00', 'george'),
  ('11111111-1111-1111-8111-000000000403', '11111111-1111-1111-8111-000000000301', '11111111-1111-1111-8111-000000000001',
   3, 'Kickoff completed + transcript',  'completed',   '2026-04-29', '2026-04-29 18:30+00', 'customer'),
  ('11111111-1111-1111-8111-000000000404', '11111111-1111-1111-8111-000000000301', '11111111-1111-1111-8111-000000000001',
   4, 'Technical setup (SSO + tenant)',  'in_progress', '2026-05-20',  null,                 'customer'),
  ('11111111-1111-1111-8111-000000000405', '11111111-1111-1111-8111-000000000301', '11111111-1111-1111-8111-000000000001',
   5, 'First-value moment (live deploy)','planned',     '2026-05-27',  null,                 'customer'),
  ('11111111-1111-1111-8111-000000000406', '11111111-1111-1111-8111-000000000301', '11111111-1111-1111-8111-000000000001',
   6, 'Week-4 adoption check',           'planned',     '2026-06-04',  null,                 'george'),
  ('11111111-1111-1111-8111-000000000407', '11111111-1111-1111-8111-000000000301', '11111111-1111-1111-8111-000000000001',
   7, 'Handover to retention',           'planned',     '2026-06-11',  null,                 'george');

insert into public.customer_health
  (id, customer_id, band, score, reason, signals)
values
  ('11111111-1111-1111-8111-000000000501',
   '11111111-1111-1111-8111-000000000001', 'green', 82,
   'Kickoff completed on time, technical setup in flight with engaged owner. No slippage signals.',
   '{"days_since_last_response": 1, "steps_overdue": 0, "responsiveness": "high"}'::jsonb);

-- ---- 2) Northwind Managed IT — YELLOW, at risk ---------------------
insert into public.customers
  (id, org_id, name, domain, lifecycle, customer_kind, industry, size, notes)
values
  ('11111111-1111-1111-8111-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'Northwind Managed IT', 'northwindmit.example', 'at_risk', 'partner',
   'Managed Services', '11-50',
   'Regional MSP. Kickoff slipped twice. Technical contact has gone quiet on SSO config.');

insert into public.contacts
  (id, customer_id, full_name, title, email, is_primary, timezone, notes)
values
  ('11111111-1111-1111-8111-000000000111',
   '11111111-1111-1111-8111-000000000002',
   'Daniel Pereira', 'Director of Service Delivery', 'daniel.pereira@northwindmit.example',
   true, 'America/Chicago',
   'Champion. Engaged but stretched thin.'),
  ('11111111-1111-1111-8111-000000000112',
   '11111111-1111-1111-8111-000000000002',
   'Sara Lindgren', 'Senior Sysadmin', 'sara.lindgren@northwindmit.example',
   false, 'America/Chicago',
   'Technical lead. No reply in 9 days — last asked for SSO metadata.');

insert into public.contracts
  (id, customer_id, status, start_date, end_date, arr_cents, currency, signed_at, summary, metadata)
values
  ('11111111-1111-1111-8111-000000000211',
   '11111111-1111-1111-8111-000000000002',
   'active', '2026-03-01', '2027-02-28', 14400000, 'USD', '2026-02-27 19:10:00+00',
   '1-year partner agreement, 20 seats. White-label included.',
   '{"seats": 20, "tier": "partner-pro", "white_label": true}'::jsonb);

insert into public.onboarding_plans
  (id, customer_id, status, start_date, target_end_date, pace, notes)
values
  ('11111111-1111-1111-8111-000000000311',
   '11111111-1111-1111-8111-000000000002',
   'in_progress', '2026-03-04', '2026-04-29', 'standard',
   'Originally an 8-week plan. Already 15 days past target. Stuck on technical setup — Sara unresponsive.');

insert into public.onboarding_steps
  (id, plan_id, customer_id, ordinal, title, status, due_date, completed_at, owner)
values
  ('11111111-1111-1111-8111-000000000411', '11111111-1111-1111-8111-000000000311', '11111111-1111-1111-8111-000000000002',
   1, 'Contract countersigned',          'completed',   '2026-03-01', '2026-03-01 18:00+00', 'george'),
  ('11111111-1111-1111-8111-000000000412', '11111111-1111-1111-8111-000000000311', '11111111-1111-1111-8111-000000000002',
   2, 'Kickoff scheduled',                'completed',   '2026-03-08', '2026-03-18 14:00+00', 'george'),
  ('11111111-1111-1111-8111-000000000413', '11111111-1111-1111-8111-000000000311', '11111111-1111-1111-8111-000000000002',
   3, 'Kickoff completed + transcript',  'completed',   '2026-03-15', '2026-03-25 17:00+00', 'customer'),
  ('11111111-1111-1111-8111-000000000414', '11111111-1111-1111-8111-000000000311', '11111111-1111-1111-8111-000000000002',
   4, 'Technical setup (SSO + tenant)',  'blocked',     '2026-04-08',  null,                 'customer'),
  ('11111111-1111-1111-8111-000000000415', '11111111-1111-1111-8111-000000000311', '11111111-1111-1111-8111-000000000002',
   5, 'First-value moment (live deploy)','planned',     '2026-04-22',  null,                 'customer'),
  ('11111111-1111-1111-8111-000000000416', '11111111-1111-1111-8111-000000000311', '11111111-1111-1111-8111-000000000002',
   6, 'Week-4 adoption check',           'planned',     '2026-04-29',  null,                 'george');

insert into public.customer_health
  (id, customer_id, band, score, reason, signals)
values
  ('11111111-1111-1111-8111-000000000511',
   '11111111-1111-1111-8111-000000000002', 'yellow', 48,
   'Technical setup blocked for 5+ weeks. Sara (tech lead) has not responded to 3 follow-ups. Champion Daniel still warm.',
   '{"days_since_last_response": 9, "steps_overdue": 2, "responsiveness": "low", "champion_engaged": true}'::jsonb);

-- ---- 3) Argonaut Systems — RED, delayed ----------------------------
insert into public.customers
  (id, org_id, name, domain, lifecycle, customer_kind, industry, size, notes)
values
  ('11111111-1111-1111-8111-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'Argonaut Systems', 'argonautsys.example', 'at_risk', 'partner',
   'Managed Services', '200-500',
   'Enterprise MSP. Highest ARR of our partners but legal/procurement has stalled the addendum since signing.');

insert into public.contacts
  (id, customer_id, full_name, title, email, is_primary, timezone, notes)
values
  ('11111111-1111-1111-8111-000000000121',
   '11111111-1111-1111-8111-000000000003',
   'Helena Brandt', 'COO', 'helena.brandt@argonautsys.example',
   true, 'Europe/London',
   'Exec sponsor. Frustrated by their own legal team. Wants escalation path.'),
  ('11111111-1111-1111-8111-000000000122',
   '11111111-1111-1111-8111-000000000003',
   'Tomás Ribeiro', 'Head of Procurement', 'tomas.ribeiro@argonautsys.example',
   false, 'Europe/London',
   'Blocking contact. Has redlined data-processing addendum twice.');

insert into public.contracts
  (id, customer_id, status, start_date, end_date, arr_cents, currency, signed_at, summary, metadata)
values
  ('11111111-1111-1111-8111-000000000221',
   '11111111-1111-1111-8111-000000000003',
   'active', '2026-02-15', '2027-02-14', 20000000, 'USD', '2026-02-13 11:00:00+00',
   '1-year partner agreement, 40 seats. DPA addendum pending Argonaut legal review.',
   '{"seats": 40, "tier": "partner-enterprise", "white_label": true, "dpa_pending": true}'::jsonb);

insert into public.onboarding_plans
  (id, customer_id, status, start_date, target_end_date, pace, notes)
values
  ('11111111-1111-1111-8111-000000000321',
   '11111111-1111-1111-8111-000000000003',
   'blocked', '2026-02-18', '2026-04-15', 'standard',
   'Plan is 29 days past target. Kickoff never happened — blocked on DPA. Helena asking for an escalation path with Onyx exec.');

insert into public.onboarding_steps
  (id, plan_id, customer_id, ordinal, title, status, due_date, completed_at, owner)
values
  ('11111111-1111-1111-8111-000000000421', '11111111-1111-1111-8111-000000000321', '11111111-1111-1111-8111-000000000003',
   1, 'Contract countersigned',          'completed', '2026-02-15', '2026-02-15 12:00+00', 'george'),
  ('11111111-1111-1111-8111-000000000422', '11111111-1111-1111-8111-000000000321', '11111111-1111-1111-8111-000000000003',
   2, 'DPA addendum signed',              'blocked',   '2026-03-01',  null,                'customer'),
  ('11111111-1111-1111-8111-000000000423', '11111111-1111-1111-8111-000000000321', '11111111-1111-1111-8111-000000000003',
   3, 'Kickoff scheduled',                'blocked',   '2026-03-08',  null,                'george'),
  ('11111111-1111-1111-8111-000000000424', '11111111-1111-1111-8111-000000000321', '11111111-1111-1111-8111-000000000003',
   4, 'Kickoff completed + transcript',  'planned',   '2026-03-22',  null,                'customer'),
  ('11111111-1111-1111-8111-000000000425', '11111111-1111-1111-8111-000000000321', '11111111-1111-1111-8111-000000000003',
   5, 'Technical setup (SSO + tenant)',  'planned',   '2026-04-08',  null,                'customer'),
  ('11111111-1111-1111-8111-000000000426', '11111111-1111-1111-8111-000000000321', '11111111-1111-1111-8111-000000000003',
   6, 'First-value moment (live deploy)','planned',   '2026-04-15',  null,                'customer');

insert into public.customer_health
  (id, customer_id, band, score, reason, signals)
values
  ('11111111-1111-1111-8111-000000000521',
   '11111111-1111-1111-8111-000000000003', 'red', 22,
   'DPA blocked for 10+ weeks. Plan 29 days past target. Exec sponsor frustrated and asking for escalation — churn risk if not addressed.',
   '{"days_since_last_response": 4, "steps_overdue": 2, "responsiveness": "medium", "blocker": "dpa_review", "escalation_requested": true}'::jsonb);

-- =====================================================================
-- END CUSTOMERS (Journey B — partners' customers)
-- =====================================================================

-- Under Helix Cloud — Lakeside Bistro Group (going well)
insert into public.customers
  (id, org_id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, notes)
values
  ('11111111-1111-1111-8111-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'Lakeside Bistro Group', 'lakesidebistro.example', 'onboarding', 'end_customer',
   '11111111-1111-1111-8111-000000000001',
   'Hospitality', '50-200',
   'Multi-location restaurant group onboarded via Helix Cloud. Wants POS + reservation consolidation.');

insert into public.contacts
  (id, customer_id, full_name, title, email, is_primary, timezone)
values
  ('11111111-1111-1111-8111-000000000131',
   '11111111-1111-1111-8111-000000000010',
   'Olivia Martín', 'Director of Operations', 'olivia.martin@lakesidebistro.example',
   true, 'America/Los_Angeles');

insert into public.onboarding_plans
  (id, customer_id, status, start_date, target_end_date, pace, notes)
values
  ('11111111-1111-1111-8111-000000000331',
   '11111111-1111-1111-8111-000000000010',
   'in_progress', '2026-04-25', '2026-06-20', 'standard',
   'Routed through Helix. Kickoff complete, locations enumerated, POS integration in progress.');

insert into public.onboarding_steps
  (plan_id, customer_id, ordinal, title, status, due_date, owner)
values
  ('11111111-1111-1111-8111-000000000331', '11111111-1111-1111-8111-000000000010', 1, 'Kickoff scheduled',               'completed', '2026-04-29', 'george'),
  ('11111111-1111-1111-8111-000000000331', '11111111-1111-1111-8111-000000000010', 2, 'Locations + users enumerated',   'completed', '2026-05-06', 'customer'),
  ('11111111-1111-1111-8111-000000000331', '11111111-1111-1111-8111-000000000010', 3, 'POS integration (Toast)',         'in_progress','2026-05-20','customer'),
  ('11111111-1111-1111-8111-000000000331', '11111111-1111-1111-8111-000000000010', 4, 'Reservation system integration',  'planned',   '2026-06-03', 'customer'),
  ('11111111-1111-1111-8111-000000000331', '11111111-1111-1111-8111-000000000010', 5, 'First weekly digest delivered',   'planned',   '2026-06-13', 'george');

insert into public.customer_health
  (customer_id, band, score, reason)
values
  ('11111111-1111-1111-8111-000000000010', 'green', 78,
   'Routed via healthy partner Helix. Locations enumerated quickly, POS integration tracking on time.');

-- Under Northwind Managed IT — Beacon Law Partners (at risk)
insert into public.customers
  (id, org_id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, notes)
values
  ('11111111-1111-1111-8111-000000000020',
   '00000000-0000-0000-0000-000000000001',
   'Beacon Law Partners', 'beaconlaw.example', 'at_risk', 'end_customer',
   '11111111-1111-1111-8111-000000000002',
   'Legal', '11-50',
   'Mid-size law firm. Routed via Northwind. Compliance-sensitive — needs SSO before any data flows.');

insert into public.contacts
  (id, customer_id, full_name, title, email, is_primary, timezone)
values
  ('11111111-1111-1111-8111-000000000141',
   '11111111-1111-1111-8111-000000000020',
   'Renée Dubois', 'Managing Partner', 'renee.dubois@beaconlaw.example',
   true, 'America/Chicago');

insert into public.onboarding_plans
  (id, customer_id, status, start_date, target_end_date, pace, notes)
values
  ('11111111-1111-1111-8111-000000000341',
   '11111111-1111-1111-8111-000000000020',
   'in_progress', '2026-03-20', '2026-05-15', 'slow',
   'Stuck because parent partner (Northwind) is stuck on SSO themselves. Compliance gate cannot open until that lands.');

insert into public.onboarding_steps
  (plan_id, customer_id, ordinal, title, status, due_date, owner)
values
  ('11111111-1111-1111-8111-000000000341', '11111111-1111-1111-8111-000000000020', 1, 'Kickoff scheduled',           'completed', '2026-03-27', 'george'),
  ('11111111-1111-1111-8111-000000000341', '11111111-1111-1111-8111-000000000020', 2, 'Compliance questionnaire',    'completed', '2026-04-10', 'customer'),
  ('11111111-1111-1111-8111-000000000341', '11111111-1111-1111-8111-000000000020', 3, 'SSO via partner tenant',      'blocked',   '2026-04-24', 'customer'),
  ('11111111-1111-1111-8111-000000000341', '11111111-1111-1111-8111-000000000020', 4, 'First weekly digest delivered','planned',  '2026-05-15', 'george');

insert into public.customer_health
  (customer_id, band, score, reason)
values
  ('11111111-1111-1111-8111-000000000020', 'yellow', 41,
   'Compliance gate blocked behind partner SSO config. Customer responsive but downstream of an upstream block.');

-- Under Argonaut Systems — Pine & Co Accounting (delayed)
insert into public.customers
  (id, org_id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, notes)
values
  ('11111111-1111-1111-8111-000000000030',
   '00000000-0000-0000-0000-000000000001',
   'Pine & Co Accounting', 'pineandco.example', 'prospect', 'end_customer',
   '11111111-1111-1111-8111-000000000003',
   'Professional Services', '50-200',
   'Routed via Argonaut. Nothing has started — waiting on Argonaut DPA to clear before any onboarding kicks off.');

insert into public.contacts
  (id, customer_id, full_name, title, email, is_primary, timezone)
values
  ('11111111-1111-1111-8111-000000000151',
   '11111111-1111-1111-8111-000000000030',
   'Andrew Pemberton', 'Managing Director', 'andrew.pemberton@pineandco.example',
   true, 'Europe/London');

insert into public.onboarding_plans
  (id, customer_id, status, start_date, target_end_date, pace, notes)
values
  ('11111111-1111-1111-8111-000000000351',
   '11111111-1111-1111-8111-000000000030',
   'planned', '2026-03-20', '2026-05-15', 'slow',
   'Plan exists on paper only. Cannot start: parent partner Argonaut DPA is unresolved.');

insert into public.onboarding_steps
  (plan_id, customer_id, ordinal, title, status, due_date, owner)
values
  ('11111111-1111-1111-8111-000000000351', '11111111-1111-1111-8111-000000000030', 1, 'Awaiting parent DPA',         'blocked', '2026-04-15', 'george'),
  ('11111111-1111-1111-8111-000000000351', '11111111-1111-1111-8111-000000000030', 2, 'Kickoff scheduled',           'planned', '2026-04-22', 'george'),
  ('11111111-1111-1111-8111-000000000351', '11111111-1111-1111-8111-000000000030', 3, 'Compliance questionnaire',    'planned', '2026-05-01', 'customer'),
  ('11111111-1111-1111-8111-000000000351', '11111111-1111-1111-8111-000000000030', 4, 'SSO via partner tenant',      'planned', '2026-05-08', 'customer');

insert into public.customer_health
  (customer_id, band, score, reason)
values
  ('11111111-1111-1111-8111-000000000030', 'red', 18,
   'Not started. Plan blocked behind parent partner contract gate. No engagement signals yet.');

-- =====================================================================
-- SIMULATED CHAT CONVERSATIONS
-- Three sessions, one per partner, channel='chat' so they show in the
-- history rail. user_id is left null (no resume() needed — opening a
-- demo session and replying creates a fresh SDK session).
-- =====================================================================

-- ---- Session 1: Helix Cloud — happy-path debrief --------------------
insert into public.agent_sessions
  (id, org_id, user_id, customer_id, title, channel, sdk_session_id, created_at, updated_at)
values
  ('11111111-1111-1111-8111-000000000601',
   '00000000-0000-0000-0000-000000000001',
   null,
   '11111111-1111-1111-8111-000000000001',
   'Helix Cloud — kickoff debrief',
   'chat', null, now() - interval '3 days', now() - interval '3 days');

insert into public.agent_messages (session_id, role, content, created_at) values
  ('11111111-1111-1111-8111-000000000601', 'user',
   'How did the Helix kickoff go? Anything I should follow up on?',
   now() - interval '3 days' + interval '0 minutes'),
  ('11111111-1111-1111-8111-000000000601', 'assistant',
   'Kickoff on Apr 29 went well. Priya (VP Ops) was engaged, Marcus (Lead Cloud Engineer) is the technical owner. Three commitments came out of it:

1. Marcus to share SSO metadata by May 6 — done, received May 5.
2. Helix to enumerate seat list (12 users) — done, complete in the workspace.
3. First test deploy targeted for week of May 18.

No follow-ups outstanding. Health is green (82). Next planned check-in: week of May 20 once the tenant setup wraps.',
   now() - interval '3 days' + interval '1 minutes'),
  ('11111111-1111-1111-8111-000000000601', 'user',
   'Great. Draft a short check-in email to Priya for next Monday confirming we''re on track for first-value the week after.',
   now() - interval '3 days' + interval '12 minutes'),
  ('11111111-1111-1111-8111-000000000601', 'assistant',
   'Drafted. Holding it for your review — I won''t send without your approval.

**To:** priya.shah@helixcloud.example
**Subject:** Helix Cloud — on track for first-value week of May 25

Hi Priya,

Quick check-in ahead of your team''s SSO + tenant cutover this week. Marcus has everything he needs from our side; once that lands we''re ready for the first live deploy the week of May 25, which keeps us on the original 8-week plan.

If anything has changed on your end, let me know and I''ll reshape the timeline. Otherwise no action needed.

Best,
George
on behalf of the Onyx team

---

Reply ''send'' to send, or tell me what to change.',
   now() - interval '3 days' + interval '13 minutes');

-- ---- Session 2: Northwind — at-risk chase --------------------------
insert into public.agent_sessions
  (id, org_id, user_id, customer_id, title, channel, sdk_session_id, created_at, updated_at)
values
  ('11111111-1111-1111-8111-000000000602',
   '00000000-0000-0000-0000-000000000001',
   null,
   '11111111-1111-1111-8111-000000000002',
   'Northwind — Sara still quiet on SSO',
   'chat', null, now() - interval '1 days', now() - interval '1 days');

insert into public.agent_messages (session_id, role, content, created_at) values
  ('11111111-1111-1111-8111-000000000602', 'user',
   'What''s the latest on Northwind? I saw the yellow flag on the dashboard.',
   now() - interval '1 days' + interval '0 minutes'),
  ('11111111-1111-1111-8111-000000000602', 'assistant',
   'Honest read: this is sliding. Plan was due to wrap Apr 29 — we''re 15 days past target.

The block is technical setup. Sara Lindgren (Senior Sysadmin) has not replied to my last three follow-ups about SSO metadata; last touch was 9 days ago. Daniel Pereira (Director, our champion) is still warm and responsive but doesn''t own the technical work himself.

Two patterns I''ve seen work here:
1. **Bypass + recover** — ask Daniel to nominate a delegate or step in personally for one focused 45-min working session. Lets us close the SSO step this week.
2. **Escalate via value** — share what the other partner customers unlocked once SSO landed (Helix is hitting first-value next week). Sometimes the social proof breaks the logjam.

I''d try (1) first because it''s lower-key and Daniel''s relationship is intact. Want me to draft that note?',
   now() - interval '1 days' + interval '1 minutes'),
  ('11111111-1111-1111-8111-000000000602', 'user',
   'Yes — draft (1) to Daniel. Keep it warm, not nagging.',
   now() - interval '1 days' + interval '8 minutes'),
  ('11111111-1111-1111-8111-000000000602', 'assistant',
   'Drafted. Awaiting your sign-off before send.

**To:** daniel.pereira@northwindmit.example
**Subject:** Northwind — one 45-min working session to unblock SSO?

Hi Daniel,

I know the SSO step has been a sticking point — Sara has had a lot on her plate, completely understand. Rather than another async ping, would it work to grab one 45-min working session this week where we walk through the metadata exchange together? Either with Sara, or with someone she nominates.

If we close that step we''re back on track for first-value in two weeks. Happy to send three slot options for Thursday or Friday — just let me know which works.

Thanks,
George
on behalf of the Onyx team

---

Reply ''send'' to send, or tell me what to change.',
   now() - interval '1 days' + interval '9 minutes');

-- ---- Session 3: Argonaut — delayed, escalation thinking ------------
insert into public.agent_sessions
  (id, org_id, user_id, customer_id, title, channel, sdk_session_id, created_at, updated_at)
values
  ('11111111-1111-1111-8111-000000000603',
   '00000000-0000-0000-0000-000000000001',
   null,
   '11111111-1111-1111-8111-000000000003',
   'Argonaut — DPA still blocked, exec escalation?',
   'chat', null, now() - interval '6 hours', now() - interval '6 hours');

insert into public.agent_messages (session_id, role, content, created_at) values
  ('11111111-1111-1111-8111-000000000603', 'user',
   'Argonaut is red. Walk me through where we are and what you''d recommend.',
   now() - interval '6 hours' + interval '0 minutes'),
  ('11111111-1111-1111-8111-000000000603', 'assistant',
   'Argonaut is our highest-ARR partner ($200k) and our most stuck. Status:

- Contract signed Feb 13.
- DPA addendum has been with Tomás Ribeiro (Head of Procurement) since Feb 18.
- Tomás has redlined it twice; last redline came back Apr 22 with 6 new asks, several of which conflict with our standard terms.
- Kickoff never happened. Plan is 29 days past its Apr 15 target.
- Helena Brandt (COO, our exec sponsor) explicitly asked last week for an Onyx-side escalation path.

What I''d do, in order:

1. **Today** — flag to whoever owns Onyx exec relationships that Helena has asked for an escalation channel. She''s asking *for* a path, not threatening churn; that''s a window we shouldn''t miss.
2. **This week** — get our legal counsel on a 30-min call with Tomás directly. Two of his open redlines are standard objections we can answer in one conversation; the other four need a real legal discussion, not email ping-pong.
3. **In parallel** — propose a scoped-down "pilot kickoff" Helena can run with 2 of the 40 seats under the existing master contract, decoupled from the addendum. Buys momentum and gives her a win to show internally.

I can draft any of those. Which do you want first?',
   now() - interval '6 hours' + interval '1 minutes'),
  ('11111111-1111-1111-8111-000000000603', 'user',
   'Start with (3) — draft the pilot kickoff proposal to Helena.',
   now() - interval '6 hours' + interval '15 minutes'),
  ('11111111-1111-1111-8111-000000000603', 'assistant',
   'Drafted. Holding for your review.

**To:** helena.brandt@argonautsys.example
**Subject:** Argonaut — a way to start this week without waiting on the DPA

Hi Helena,

Thank you for being so direct about the DPA holdup last week. While our legal team works the addendum with Tomás (separate note coming on that), I want to propose something that lets you move now.

Under the master agreement you''ve already signed, we can run a scoped pilot with 2 of your 40 seats — just enough to do a real kickoff, complete the technical setup, and prove the first-value moment internally. No new paperwork required. We''d formally roll the remaining 38 seats once the DPA is settled.

If that''s useful, I can have a kickoff on your calendar within 5 business days. Let me know.

Best,
George
on behalf of the Onyx team

---

Reply ''send'' to send, or tell me what to change.',
   now() - interval '6 hours' + interval '16 minutes');

commit;

-- =====================================================================
-- Quick verification — counts after seed.
-- =====================================================================
select 'customers'        as tbl, count(*) from public.customers        where id::text like '11111111-1111-1111-8111-%' union all
select 'contacts'         as tbl, count(*) from public.contacts         where customer_id::text like '11111111-1111-1111-8111-%' union all
select 'contracts'        as tbl, count(*) from public.contracts        where customer_id::text like '11111111-1111-1111-8111-%' union all
select 'onboarding_plans' as tbl, count(*) from public.onboarding_plans where customer_id::text like '11111111-1111-1111-8111-%' union all
select 'onboarding_steps' as tbl, count(*) from public.onboarding_steps where customer_id::text like '11111111-1111-1111-8111-%' union all
select 'customer_health'  as tbl, count(*) from public.customer_health  where customer_id::text like '11111111-1111-1111-8111-%' union all
select 'agent_sessions'   as tbl, count(*) from public.agent_sessions   where id::text like '11111111-1111-1111-8111-%' union all
select 'agent_messages'   as tbl, count(*) from public.agent_messages   where session_id::text like '11111111-1111-1111-8111-%';
