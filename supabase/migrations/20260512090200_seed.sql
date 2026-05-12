-- =====================================================================
-- Seed: the Onyx org + a starter knowledge doc.
-- Idempotent — safe to re-run.
-- =====================================================================

insert into public.orgs (id, name, domain)
values ('00000000-0000-0000-0000-000000000001', 'Onyx', 'getonyx.ai')
on conflict (id) do nothing;

insert into public.knowledge_docs (org_id, path, title, content_md, source)
values (
  '00000000-0000-0000-0000-000000000001',
  'onboarding/playbook.md',
  'Onyx Onboarding Playbook',
  $kb$# Onyx Onboarding Playbook

> Replace this with the real playbook content. George reads from this table
> at runtime to answer "how do we onboard" and to plan customer milestones.

## Stages
1. Contract & NDA received
2. Kickoff scheduled
3. Kickoff completed (Fireflies transcript ingested)
4. Technical setup
5. First-value moment
6. Adoption check (week 4)
7. Handover to retention (week 8)
$kb$,
  'manual'
)
on conflict (org_id, path) do nothing;
