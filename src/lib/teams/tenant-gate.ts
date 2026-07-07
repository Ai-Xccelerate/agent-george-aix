/**
 * Pure parsing/gating logic for inbound Teams activities, split out from
 * process-event.ts and route.ts so it's unit-testable without spinning up
 * the Bot Framework adapter or Supabase.
 *
 * The tenant gate is deliberately the allowlist for this whole surface — no
 * Supabase-authenticated session exists on this path, so this check plus
 * the Bot Framework JWT signature (verified separately by the adapter) are
 * the only things standing between an arbitrary caller and George. See
 * docs/BACKLOG.md #31.
 */

export type MinimalTeamsActivity = {
  id?: string;
  text?: string;
  conversation?: { id?: string; tenantId?: string } | null;
  channelData?: { tenant?: { id?: string } } | null;
};

/**
 * Teams puts the tenant id on `activity.conversation.tenantId` for personal
 * scope, and sometimes only on `activity.channelData.tenant.id` depending on
 * channel/version — check both, reject if neither matches.
 */
export function extractTenantId(activity: MinimalTeamsActivity): string | null {
  return (
    activity.conversation?.tenantId ?? activity.channelData?.tenant?.id ?? null
  );
}

export function isFromAllowedTenant(
  activity: MinimalTeamsActivity,
  expectedTenantId: string | null | undefined,
): boolean {
  if (!expectedTenantId) return false;
  const actual = extractTenantId(activity);
  return actual != null && actual === expectedTenantId;
}

export function extractConversationId(
  activity: MinimalTeamsActivity,
): string | null {
  return activity.conversation?.id ?? null;
}
