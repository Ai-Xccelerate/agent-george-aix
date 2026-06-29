-- George's operating model — the team-controllable layer of his behavior:
-- Tier-2 toggles (optional behaviors) and Tier-3 tunables (numbers, selects,
-- free-text house rules). Edited from /settings/agent/policy.
--
-- Stored SPARSE: only the keys an admin has changed from the catalog default
-- live here ({ "max_actions": 5, "proactive_churn_alerts": false }). The policy
-- catalog itself is defined in code (src/lib/agent/operating-model.ts) and
-- merged over these overrides at read time, so adding a new policy in code
-- auto-applies its default to every existing org with no backfill.
--
-- Hard guardrails (draft-never-send, no SKU invention, etc.) are NOT here —
-- they stay hardcoded in the system prompt and render read-only in the UI.

alter table public.agent_settings
  add column if not exists operating_policy jsonb not null default '{}'::jsonb;
