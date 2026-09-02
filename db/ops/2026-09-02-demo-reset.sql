-- Demo reset: archive Harbourline Freight, seed Nordvik Logistics.
--
-- ORDER MATTERS. Run migration 0006 first — this script sets `archived_at`,
-- which does not exist until then:
--
--   cd db && export DATABASE_URL="<staging>" && alembic upgrade head
--   cd .. && railway connect postgres-bl1d < db/ops/2026-09-02-demo-reset.sql
--
-- AND THE CODE HAS TO BE DEPLOYED. Setting `archived_at` hides nothing on its
-- own — the filters that honour it (customer list, find_customer,
-- list_customers, the objectives scan, the silence sweep) ship with the same
-- change. Applying the migration without deploying leaves Harbourline exactly
-- where it is, on the list.
--
-- WHY ARCHIVE RATHER THAN DELETE
-- Harbourline carries the record of the onboarding loop running end to end on
-- 2026-09-02: three touchpoints, a real customer reply read from mailbox_sync,
-- and an objective George created from it with a next_followup_at he set
-- himself. Deleting the customer cascades over all of it. That record is the
-- best evidence the feature works and is worth having to hand during a demo,
-- not destroyed to tidy a list. Archiving takes it off the list and stops
-- George working it; nothing is lost and it reverses with one UPDATE.

\pset pager off

begin;

-- ── 1. Harbourline off the book ──────────────────────────────────────────
update customers
set archived_at = now(), updated_at = now()
where id = '5eed0000-0000-4000-8000-000000000001'
  and archived_at is null;

-- ── 2. A clean account to demo against ───────────────────────────────────
-- Deliberately NOT a blank record. The composer prompt now requires at least
-- one detail true only of this account — a date, a milestone, a named blocker —
-- and refuses to be satisfied by an email that could go to anybody. A customer
-- with no contract date and no go-live gives it nothing to be specific with,
-- and the demo would show the weaker email.
insert into customers (id, org_id, name, domain, lifecycle, customer_kind, industry, size, notes)
values (
  '5eed0000-0000-4000-8000-000000000002',
  'b716e8dd-db8f-4f68-9ff2-f4babda9ddd2',
  'Nordvik Logistics',
  'nordviklogistics.com',
  'onboarding',
  'partner',
  'Freight & logistics',
  '120 staff',
  'Seeded for the demo on 2026-09-02. Signed 2026-08-26, go-live 2026-09-25.'
);

-- Primary contact. An aixccelerate.com address, so the send is allowed by the
-- internal-domain rule and gmail.com can be revoked from the allowlist without
-- breaking the demo.
insert into contacts (customer_id, full_name, title, email, is_primary, role, timezone)
values (
  '5eed0000-0000-4000-8000-000000000002',
  'Vidhi Mishra',
  'Operations Lead',
  'vidhi@aixccelerate.com',
  true,
  'champion',
  'Asia/Kolkata'
);

-- A second, non-primary contact so the recipient-resolution step has a real
-- choice to get right rather than one obvious answer.
insert into contacts (customer_id, full_name, title, email, is_primary, role)
values (
  '5eed0000-0000-4000-8000-000000000002',
  'Anders Holt',
  'IT Manager',
  'anders.holt@nordviklogistics.com',
  false,
  'technical_lead'
);

-- Signed a week ago. Gives the composer a real date to reference.
insert into contracts (customer_id, status, signed_at, start_date, end_date, arr_cents, currency, summary)
values (
  '5eed0000-0000-4000-8000-000000000002',
  'active',
  '2026-08-26',
  '2026-09-01',
  '2027-08-31',
  4800000,
  'USD',
  'Annual platform subscription, 120 seats.'
);

-- Go-live on 25 September: the fact the new prompt uses as its worked example
-- of saying a thing like a colleague rather than like machinery.
-- status is the `onboarding_status` enum: planned | in_progress | blocked |
-- completed | cancelled. Not 'active' — that is the contract vocabulary, and
-- the two are easy to mix up.
insert into onboarding_plans (customer_id, status, start_date, target_end_date, pace, notes)
values (
  '5eed0000-0000-4000-8000-000000000002',
  'in_progress',
  '2026-09-01',
  '2026-09-25',
  'Fixed go-live — their peak freight season starts the last week of September.',
  'Standard onboarding, no fast-track requested.'
);

-- No touchpoints and no health rows on purpose: the demo is clicking Onboard
-- and watching George assess the state and compose, not reading something that
-- was already there.

\echo '--- result ---'
select name, lifecycle, archived_at is not null as archived
from customers
where org_id = 'b716e8dd-db8f-4f68-9ff2-f4babda9ddd2'
order by archived, name;

-- Change to ROLLBACK to rehearse without writing.
commit;
