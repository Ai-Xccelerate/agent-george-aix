-- Real customers on the Customer screen, and the evidence attached to them.
--
-- WHY THIS IS A SCRIPT AND NOT AN AGENTDB SYNC
-- AgentDB is the CRM and cannot supply this today. AGENTDB_API_URL is set on
-- staging but AGENTDB_INTERNAL_AGENT_KEY is not set at all, so the integration
-- reports itself off before any org permission is tested; the 403 for the `aix`
-- org is a second blocker behind a missing credential. These rows are therefore
-- entered by hand, and `notes` says so on every one, so nobody later mistakes
-- them for synced data. The sync stays pending.
--
-- WHERE THE NAMES AND LIFECYCLES COME FROM
-- Meeting evidence, not guesswork. 354 transcripts, filtered to the 125 with
-- one or two external domains (a real account call) rather than the 8 with six
-- or more, which are one recurring IAMCP community call and would otherwise
-- have created ~28 junk accounts.
--
-- Lifecycle is read off the meeting titles, which are unusually honest:
--   "AIX<>X Weekly connect"        -> a live account
--   "Review ... Proposal"          -> a prospect
--   "OnBoarding ... Trial"         -> onboarding
-- Anything not evidenced is left for a human. No contracts are invented.
--
-- nylas.com clears every behavioural filter and is deliberately absent: it is
-- the mail vendor. That is the judgement no query can make.

\pset pager off

begin;

-- ── 1. The accounts ──────────────────────────────────────────────────────
insert into customers (org_id, name, domain, lifecycle, customer_kind, notes)
values
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','Onyx','getonyx.ai','active','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). 14 meetings, most recent 2026-09-03 — "Onyx Core 2.0 & Support Hub".'),
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','Sugar Estate Media','sugarestatemedia.com','active','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). 9 meetings on a weekly connect cadence; last 2026-08-17.'),
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','PSS Tec','psstec.com','active','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). 6 meetings, "AIX<>PSS Tec - Weekly Connect"; last 2026-08-14.'),
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','SIMNET','simnet.ca','active','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). 4 meetings, "SIMNET | AI X Connect"; last 2026-08-20.'),
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','Amnet Digital','amnetdigital.com','active','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). 3 meetings on a weekly connect; last 2026-08-03 — 32 days, worth a look.'),
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','Castor One','castorone.com','onboarding','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). "OnBoarding Castor to AIX for Jules and Nick Trial"; last 2026-08-12.'),
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','EAP Expert','eapexpert.com','prospect','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). "Review AI Agent Mike Proposal" — proposal stage, not a customer. 5 meetings.'),
  ('b716e8dd-db8f-4f68-9ff2-f4babda9ddd2','Phantm','getphantm.ai','prospect','partner',
   'Entered by hand 2026-09-04 (AgentDB sync pending). 3 meetings, "Followup with Phantm"; last 2026-08-31.')
on conflict do nothing;

\echo '--- accounts now on the screen ---'
select name, lifecycle, domain from customers
where org_id='b716e8dd-db8f-4f68-9ff2-f4babda9ddd2' and archived_at is null
order by lifecycle, name;

-- ── 2. Attach the evidence ───────────────────────────────────────────────
-- 352 of 362 transcripts had no customer_id. They are not thin: 302 of the
-- orphans carry a summary, insights and full text. The enrichment ran and the
-- attribution never did, which is why an account page would look empty however
-- well it were built.
--
-- Attributed only where the meeting has ONE matching customer domain. A call
-- with two customers on it is a real thing and guessing which it "belongs to"
-- would put one account's story on another's page.
with per_meeting as (
  select m.id as meeting_id,
         (array_agg(distinct c.id))[1] as customer_id,
         count(distinct c.id) as matches
  from meeting_transcripts m
  cross join lateral jsonb_array_elements(m.attendees) att
  join customers c
    on c.domain is not null
   and c.archived_at is null
   and lower(split_part(att->>'email','@',2)) = lower(c.domain)
  where m.customer_id is null
    and jsonb_typeof(m.attendees) = 'array'
  group by m.id
)
update meeting_transcripts m
set customer_id = p.customer_id, updated_at = now()
from per_meeting p
where m.id = p.meeting_id and p.matches = 1;

\echo '--- transcript attribution after ---'
select count(*) total, count(customer_id) attributed,
       round(100.0*count(customer_id)/count(*),1) as pct
from meeting_transcripts;

-- Same for mail, on either side of the envelope.
update email_messages e
set customer_id = c.id, updated_at = now()
from customers c
where e.customer_id is null
  and c.domain is not null and c.archived_at is null
  and (lower(split_part(e.from_address,'@',2)) = lower(c.domain)
       or e.to_recipients::text ilike '%@' || c.domain || '%');

\echo '--- email attribution after ---'
select count(*) total, count(customer_id) attributed from email_messages;

-- ── 3. Escalations are Rahul's to see first ──────────────────────────────
-- `notify` was parsed by tenant-process.ts and read by nothing, which is the
-- same shape operating_mode was in: a setting that looked like a control and
-- decided nothing. Setting it is half the fix; the code that surfaces it is in
-- the same change.
update tenant_process
set escalation = jsonb_set(escalation, '{notify}', '"rahul@aixccelerate.com"'),
    updated_at = now();

\echo '--- who decides ---'
select o.name as org, tp.escalation->>'notify' as notify
from tenant_process tp join orgs o on o.id=tp.org_id order by 1;

commit;
