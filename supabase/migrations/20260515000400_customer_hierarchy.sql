-- Partner / End-customer hierarchy on `customers` (backlog #20).
--
-- Onyx's business has two distinct journeys:
--   Journey A: Onyx → Partner / MSP
--   Journey B: Partner → End Customer
--
-- We model both with the same table — same lifecycle, contacts, contracts,
-- onboarding plans — distinguished by `customer_kind` and an optional
-- `parent_customer_id` self-reference. An end_customer must point to its
-- partner; a partner must not have a parent.

create type customer_kind as enum (
  'partner',       -- MSP / direct customer of Onyx (Journey A target)
  'end_customer'   -- customer of one of our partners (Journey B target)
);

alter table public.customers
  add column if not exists customer_kind     customer_kind not null default 'partner',
  add column if not exists parent_customer_id uuid references public.customers(id) on delete set null;

-- Backfill: every existing row is a partner (this is true for the seed +
-- everything created to date — the chat-first flow only knew about partners).
update public.customers set customer_kind = 'partner' where customer_kind is null;

-- Shape constraint enforced in SQL so the agent (or a future UI bug) can't
-- create dangling end customers or hierarchical partners.
alter table public.customers
  drop constraint if exists customers_kind_parent_check;
alter table public.customers
  add constraint customers_kind_parent_check check (
    (customer_kind = 'partner'      and parent_customer_id is null)
    or
    (customer_kind = 'end_customer' and parent_customer_id is not null)
  );

create index if not exists customers_parent_idx
  on public.customers (parent_customer_id)
  where parent_customer_id is not null;

create index if not exists customers_kind_idx
  on public.customers (org_id, customer_kind);
