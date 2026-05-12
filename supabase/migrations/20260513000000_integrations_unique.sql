-- Allow upsert(onConflict='org_id,provider') from the Composio callback handler.
create unique index if not exists integrations_org_provider_unique
  on public.integrations (org_id, provider);
