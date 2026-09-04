-- Undo attribution made through a free-mail domain.
--
-- WHAT WENT WRONG
-- The attribution join matched a meeting to a customer when an attendee's email
-- domain equalled the customer's domain. Acme Tech — a demo account — has its
-- domain recorded as `gmail.com`, so every meeting with any personal Gmail
-- address on it was attributed to Acme Tech. 25 meetings, none of them theirs.
--
-- The join was right; the data it trusted was not. A free-mail domain
-- identifies a person, never a company, so it can never be evidence that a
-- meeting belongs to an account.
--
-- THE FIX IS IN TWO PLACES
-- Here, to undo the bad rows and to stop a free-mail domain being usable as a
-- customer domain at all. And in the attribution query itself, which now
-- excludes these domains rather than relying on nobody ever entering one.

\pset pager off

begin;

\echo '--- meetings wrongly attached through a free-mail domain ---'
select c.name, c.domain, count(m.id) as meetings
from customers c join meeting_transcripts m on m.customer_id = c.id
where lower(c.domain) in ('gmail.com','googlemail.com','outlook.com','hotmail.com',
                          'yahoo.com','icloud.com','proton.me','protonmail.com','aol.com')
group by 1,2;

update meeting_transcripts m
set customer_id = null, updated_at = now()
from customers c
where m.customer_id = c.id
  and lower(c.domain) in ('gmail.com','googlemail.com','outlook.com','hotmail.com',
                          'yahoo.com','icloud.com','proton.me','protonmail.com','aol.com');

update email_messages e
set customer_id = null, updated_at = now()
from customers c
where e.customer_id = c.id
  and lower(c.domain) in ('gmail.com','googlemail.com','outlook.com','hotmail.com',
                          'yahoo.com','icloud.com','proton.me','protonmail.com','aol.com');

-- A free-mail address is not a company domain. Clearing it rather than guessing
-- the real one: an empty field is honest, a wrong one is not, and George's
-- send-authority checks read this column.
update customers
set domain = null, updated_at = now()
where lower(domain) in ('gmail.com','googlemail.com','outlook.com','hotmail.com',
                        'yahoo.com','icloud.com','proton.me','protonmail.com','aol.com');

\echo '--- attribution after ---'
select count(*) total, count(customer_id) attributed,
       round(100.0*count(customer_id)/count(*),1) pct
from meeting_transcripts;

\echo '--- evidence per account ---'
select c.name, c.lifecycle, coalesce(c.domain,'(none)') as domain,
       (select count(*) from meeting_transcripts m where m.customer_id=c.id) as meetings
from customers c
where c.org_id='b716e8dd-db8f-4f68-9ff2-f4babda9ddd2' and c.archived_at is null
order by 4 desc, 1;

commit;
