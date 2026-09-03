-- Dismiss the stacked mailbox-integration escalations.
--
-- WHAT THIS CLEARS
-- 34 open escalations raised between 2026-07-18 and 2026-09-02 that all report
-- ONE condition: the mailbox integration returning 401. George re-reported it
-- every time anything touched the mail path, and because `escalations` had no
-- dedupe key, each report looked new. By the end he was escalating about the
-- escalation backlog itself ("12 stacked Outlook-integration escalations — 44
-- days unresolved"), which is the same fault eating its own tail.
--
-- WHY IT IS SAFE TO CLEAR THEM NOW
-- The condition is fixed. Nylas was disconnected from every org except the one
-- George actually runs as, and the sync is confirmed live — a real customer
-- reply was processed end to end at 13:03 on 2026-09-02, no injection. George's
-- own most recent row (2026-09-02) says "appears resolved; please close".
--
-- WHY `dismissed` AND NOT `resolved`
-- Nobody decided anything. These were duplicate reports of a fault that was
-- fixed elsewhere, and `resolved` would claim a judgement that never happened.
--
-- EIGHT OF THESE CARRY A customer_id
-- They name real account work (chasing Krishna at Mondello, the Stonehaas
-- workshop) but they name it against deadlines that read "TODAY" and fell in
-- the week of 2026-08-21. That work is either done or long overdue, and either
-- way it needs raising fresh with a current date rather than being carried on a
-- fortnight-old row. Review the list this prints before committing if you would
-- rather keep them.
--
-- REVERSIBLE
-- Set status back to 'open'. Nothing is deleted.
--
-- RUN IT
--   export PATH="/c/Program Files/PostgreSQL/17/bin:$PATH"
--   railway connect postgres-bl1d < db/ops/2026-09-02-dismiss-integration-401s.sql

\pset pager off

begin;

create temp table closing as
select id, title, customer_id
from escalations
where status = 'open'
  and title ~* '(nylas|401|outlook|m365|email tool|mail(box)? (is )?(down|offline|inoperative|broken)|integration (broken|error|down|still broken))';

\echo '--- how many, and which of them name an account ---'
select count(*) as will_dismiss from closing;
select id, coalesce(customer_id::text, '(no customer)') as customer, left(title, 70) as title
from closing
where customer_id is not null
order by title;

update escalations e
set status      = 'dismissed',
    resolved_by = 'system',
    resolved_at = now(),
    resolution  = 'Dismissed in bulk on 2026-09-02: duplicate reports of the mailbox 401, '
               || 'which was fixed by disconnecting Nylas from every org except the one '
               || 'George runs as. Sync confirmed live the same day. They stacked because '
               || 'escalations had no dedupe key; migration 0007 adds one. Reversible — set '
               || 'status back to open.',
    updated_at  = now()
from closing c
where e.id = c.id;

\echo '--- queue after ---'
select status, count(*) from escalations group by 1 order by 2 desc;

-- Change to ROLLBACK first if you want to see the counts without writing.
commit;
