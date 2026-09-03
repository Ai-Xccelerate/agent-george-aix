-- Add one demo customer. Runs on staging as-is (revision 0005) — no migration.
--
--   export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
--   railway connect postgres-bl1d < db/ops/add-demo-customer.sql
--
-- Idempotent: re-running it changes nothing. Safe to paste twice.
--
-- The dates are the point, not decoration. The composer now refuses to be
-- satisfied by an email that could go to any customer, so an account with no
-- contract date and no go-live gives it nothing to be specific with and demos
-- the weaker email. Signed 26 Aug, go-live 25 Sept.

\pset pager off

begin;

insert into customers (id, org_id, name, domain, lifecycle, customer_kind, industry, size, notes)
values (
  '5eed0000-0000-4000-8000-000000000002',
  'b716e8dd-db8f-4f68-9ff2-f4babda9ddd2',      -- AIX Staging
  'Nordvik Logistics',
  'nordviklogistics.com',
  'onboarding',
  'partner',
  'Freight & logistics',
  '120 staff',
  'Demo account. Signed 2026-08-26, go-live 2026-09-25.'
)
on conflict (id) do nothing;

-- Primary contact on an internal domain, so the send is allowed without an
-- allowlist entry and gmail.com can still be revoked.
insert into contacts (customer_id, full_name, title, email, is_primary, role, timezone)
select '5eed0000-0000-4000-8000-000000000002',
       'Vidhi Mishra', 'Operations Lead', 'vidhi@aixccelerate.com', true, 'champion', 'Asia/Kolkata'
where not exists (
  select 1 from contacts
  where customer_id = '5eed0000-0000-4000-8000-000000000002'
    and email = 'vidhi@aixccelerate.com'
);

-- A second, non-primary contact so recipient resolution has a real choice to
-- get right rather than one obvious answer.
insert into contacts (customer_id, full_name, title, email, is_primary, role)
select '5eed0000-0000-4000-8000-000000000002',
       'Anders Holt', 'IT Manager', 'anders.holt@nordviklogistics.com', false, 'technical_lead'
where not exists (
  select 1 from contacts
  where customer_id = '5eed0000-0000-4000-8000-000000000002'
    and email = 'anders.holt@nordviklogistics.com'
);

insert into contracts (customer_id, status, signed_at, start_date, end_date, arr_cents, currency, summary)
select '5eed0000-0000-4000-8000-000000000002',
       'active', '2026-08-26', '2026-09-01', '2027-08-31', 4800000, 'USD',
       'Annual platform subscription, 120 seats.'
where not exists (
  select 1 from contracts where customer_id = '5eed0000-0000-4000-8000-000000000002'
);

-- status is the `onboarding_status` enum: planned | in_progress | blocked |
-- completed | cancelled. Not 'active' — that is contract vocabulary.
insert into onboarding_plans (customer_id, status, start_date, target_end_date, pace, notes)
select '5eed0000-0000-4000-8000-000000000002',
       'in_progress', '2026-09-01', '2026-09-25',
       'Fixed go-live — their peak freight season starts the last week of September.',
       'Standard onboarding, no fast-track requested.'
where not exists (
  select 1 from onboarding_plans where customer_id = '5eed0000-0000-4000-8000-000000000002'
);

\echo '--- created ---'
select c.name, c.lifecycle,
       (select count(*) from contacts k where k.customer_id = c.id) as contacts,
       (select count(*) from contracts t where t.customer_id = c.id) as contracts,
       (select target_end_date from onboarding_plans p where p.customer_id = c.id) as go_live
from customers c
where c.id = '5eed0000-0000-4000-8000-000000000002';

commit;
