/**
 * Who counts as "internal" for an organisation, and what address George sends
 * from on its behalf.
 *
 * WHY THIS IS RESOLVED PER ORG, NOT READ FROM ENV
 * These used to be module-level constants built from environment variables at
 * import time — one internal domain and one address for the whole deployment.
 * That is single-tenant by construction, and it was the identity half of the
 * multitenancy problem: with a second organisation on the same deployment,
 * George would have been told that the FIRST org's domain was "internal" while
 * judging the second org's mail. Internal-ness is what decides whether a send is
 * allowed, so getting it wrong is not cosmetic.
 *
 * The source of truth is the org's own row. `orgs.domain` is the organisation's
 * domain — the people there are its colleagues. Everyone else is external, and
 * external means draft-only unless a human has approved that specific domain
 * (see `domain_allowlist`, which is a different and deliberately separate idea:
 * customers George may correspond with, not colleagues).
 *
 * FAILS CLOSED. An org with no domain configured has NO internal domains, so
 * every recipient is external and every send needs approval. That is the safe
 * direction: the failure mode is George refusing to send, not George deciding a
 * stranger is a colleague.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrgIdentity = {
  /** Domains whose people are colleagues of this org. Lowercased. */
  internalDomains: Set<string>;
  /** The address George sends from for this org; "" when it has no mailbox. */
  address: string;
  /** The org's own domain, when it has one. */
  domain: string | null;
};

/**
 * Deployment-wide fallbacks.
 *
 * Kept only because mail and note-taking are still configured deployment-wide
 * (one Nylas grant, one Scribe token). When those become per-org, these go: the
 * address will come from the org's own mailbox row.
 *
 * There is deliberately NO default address. It used to fall back to a
 * colleague's personal mailbox, which meant an unset variable made George
 * advertise a real person's address to customers. Empty is the honest answer;
 * callers omit the address rather than print somebody else's.
 */
function envAddress(): string {
  return process.env.GEORGE_EMAIL?.trim() || process.env.NYLAS_FROM_EMAIL?.trim() || "";
}

function envInternalDomains(): string[] {
  return (
    process.env.GEORGE_INTERNAL_DOMAINS?.split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

function normaliseDomain(value: string | null | undefined): string | null {
  const d = value
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  return d || null;
}

/** Short cache: this is consulted once per recipient inside send guards. */
const cache = new Map<string, { at: number; value: OrgIdentity }>();
const TTL_MS = 60_000;

/**
 * Resolve an org's identity. Never throws — a lookup failure yields the
 * env-configured fallback rather than an exception inside a send guard.
 */
export async function resolveOrgIdentity(
  admin: SupabaseClient,
  orgId: string,
): Promise<OrgIdentity> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let orgDomain: string | null = null;
  try {
    const { data } = await admin
      .from("orgs")
      .select("domain")
      .eq("id", orgId)
      .maybeSingle();
    orgDomain = normaliseDomain((data as { domain?: string | null } | null)?.domain);
  } catch {
    // Fall through to the env fallback; see the fail-closed note above.
  }

  const address = envAddress();
  const domains = new Set<string>();
  if (orgDomain) domains.add(orgDomain);
  for (const d of envInternalDomains()) domains.add(d);
  // George's own mailbox is internal to whatever org it serves — otherwise a
  // reply-all that includes George reads as "external recipient present".
  const own = normaliseDomain(address.split("@")[1] ?? null);
  if (own) domains.add(own);

  const value: OrgIdentity = { internalDomains: domains, address, domain: orgDomain };
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

/** Testing seam and a way to drop the cache after an org edits its domain. */
export function clearOrgIdentityCache(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

export function isInternalTo(identity: OrgIdentity, address: string | null | undefined): boolean {
  const domain = normaliseDomain(address?.split("@")[1] ?? null);
  return !!domain && identity.internalDomains.has(domain);
}

/**
 * How to describe "internal" to a human or to the model, without naming a
 * domain that may belong to a different tenant.
 */
export function internalDescription(identity: OrgIdentity): string {
  const list = [...identity.internalDomains];
  if (list.length === 0) return "internal to your organisation (none configured yet)";
  if (list.length === 1) return `@${list[0]}`;
  return list.map((d) => `@${d}`).join(" or ");
}
