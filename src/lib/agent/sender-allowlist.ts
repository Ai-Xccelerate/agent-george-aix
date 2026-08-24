import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveOrgIdentity } from "./identity";

/**
 * Domain allowlist gate for inbound email. The Composio M365 webhook passes
 * each delivery through this — if the sender isn't on the
 * allowlist, we acknowledge with 200 (so the provider stops retrying) but
 * we DON'T create an agent_events row, so the inbox stays signal-only.
 *
 * The audit_log row is still written by the caller, so rejected deliveries
 * are inspectable for later widening of the allowlist.
 *
 * The rule:
 *   - Anyone at the ORGANISATION'S OWN DOMAIN is allowed (the team).
 *   - Anything in contacts.email for this org is allowed (known customer
 *     people we've manually added).
 *   - Everything else is rejected.
 *
 * WHOSE TEAM, THOUGH
 * This used to be a hardcoded pair:
 *
 *     const ORG_DOMAINS = new Set(["getonyx.ai", "aixccelerate.com"]);
 *
 * Two different companies' domains, in the function that decides who may wake
 * George. For a third organisation nobody could ever reach him, and for either
 * of those two, the OTHER company's staff could — across a tenant boundary, on
 * the path that starts an autonomous agent run.
 *
 * It is resolved per org now, from that org's own row, the same source the send
 * guard uses. One definition of "internal", not two that can disagree.
 *
 * FAILS CLOSED, and that is a real trade: an org with no domain configured
 * accepts inbound only from its known contacts. Silence is recoverable — a
 * stranger waking the agent is not.
 */

export type AllowlistDecision =
  | { allowed: true; reason: "org-domain" | "known-contact" }
  | { allowed: false; reason: "no-from" | "domain-not-allowlisted" };

export function extractDomain(address: string | null | undefined): string | null {
  if (!address) return null;
  // Strip "Name <addr@example.com>" wrapping if present.
  const m = address.match(/<([^>]+)>/);
  const clean = (m ? m[1] : address).trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 0) return null;
  return clean.slice(at + 1) || null;
}

export async function isSenderAllowed(
  orgId: string,
  fromAddress: string | null | undefined,
): Promise<AllowlistDecision> {
  if (!fromAddress) {
    return { allowed: false, reason: "no-from" };
  }
  const domain = extractDomain(fromAddress);
  if (!domain) {
    return { allowed: false, reason: "no-from" };
  }
  const admin = createSupabaseAdmin();

  // The org's own people, per org — not a hardcoded pair of companies.
  //
  // Match on the EXTRACTED domain, not the raw header value: a normal client
  // sends "Name <addr@example.com>", and splitting that on "@" yields
  // "example.com>" — so passing the raw string here rejected every colleague
  // who has a display name set, which is nearly all of them.
  const identity = await resolveOrgIdentity(admin, orgId);
  if (identity.internalDomains.has(domain)) {
    return { allowed: true, reason: "org-domain" };
  }

  // Strip wrapping again for the literal-match contact lookup.
  const m = fromAddress.match(/<([^>]+)>/);
  const clean = (m ? m[1] : fromAddress).trim().toLowerCase();

  const contact = await admin
    .from("contacts")
    .select("id")
    .eq("org_id", orgId)
    .eq("email", clean)
    .maybeSingle();
  if (contact.data) {
    return { allowed: true, reason: "known-contact" };
  }

  return { allowed: false, reason: "domain-not-allowlisted" };
}
