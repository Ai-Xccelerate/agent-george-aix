-- One customer per domain, per org. George resolves-or-creates by domain in the
-- create_customer tool, but two autonomous runs racing on the same inbound
-- signal could still each insert — so enforce it at the database too. The
-- create paths catch 23505 and fall back to the existing row.
--
-- Case-insensitive (acme.com == Acme.com), and only where a domain is set
-- (multiple domain-less rows are allowed).
create unique index customers_org_domain_unique
  on public.customers (org_id, lower(domain))
  where domain is not null;
