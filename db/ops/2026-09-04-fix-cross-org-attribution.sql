-- Undo transcript attribution that crossed an org boundary.
--
-- WHAT WENT WRONG
-- 2026-09-04-real-customers-and-attribution.sql matched a transcript to a
-- customer when an attendee's email domain equalled the customer's domain. It
-- never checked that the transcript and the customer belonged to the same org.
--
-- 25 transcripts ended up attached across tenants: the Fireflies sync lands
-- meetings under the `aix` org, and the customers were created under `AIX
-- Staging`. So one tenant's meeting content became another tenant's account
-- history. In this environment both orgs are AIX's own, so nothing leaked to a
-- third party — but the query would do exactly the same thing between two real
-- customers' orgs, and that is the shape of a tenancy breach.
--
-- HOW IT SURFACED
-- Not by review. The engagement board's loader filters meetings by org, as
-- every query in this codebase does, so it correctly reported "never met" for
-- accounts that visibly had meetings. The mismatch between those two answers
-- is what exposed it.
--
-- THE FIX IS IN BOTH PLACES
-- Here, to detach the rows; and in the attribution query, which now requires
-- m.org_id = c.org_id. Org scoping is not something to remember to add.

\pset pager off

begin;

\echo '--- transcripts attached across an org boundary ---'
select c.name, oc.name as customer_org, om.name as transcript_org, count(*) as n
from meeting_transcripts m
join customers c on c.id = m.customer_id
join orgs oc on oc.id = c.org_id
join orgs om on om.id = m.org_id
where m.org_id <> c.org_id
group by 1,2,3 order by 4 desc;

update meeting_transcripts m
set customer_id = null, updated_at = now()
from customers c
where m.customer_id = c.id and m.org_id <> c.org_id;

update email_messages e
set customer_id = null, updated_at = now()
from customers c
where e.customer_id = c.id and e.org_id <> c.org_id;

\echo '--- attribution after, by org ---'
select o.name as org, count(*) as transcripts, count(m.customer_id) as attributed
from meeting_transcripts m join orgs o on o.id = m.org_id
group by 1 order by 2 desc;

commit;
