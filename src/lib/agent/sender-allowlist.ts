import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Domain allowlist gate for inbound email. The Composio M365 webhook passes
 * each delivery through this — if the sender isn't on the
 * allowlist, we acknowledge with 200 (so the provider stops retrying) but
 * we DON'T create an agent_events row, so the inbox stays signal-only.
 *
 * The audit_log row is still written by the caller, so rejected deliveries
 * are inspectable for later widening of the allowlist.
 *
 * v1 rule (locked-in until customers table is populated):
 *   - getonyx.ai and aixccelerate.com are always allowed (the team).
 *   - Anything in contacts.email for this org is allowed (known customer
 *     people we've manually added).
 *   - Everything else is rejected.
 */
const ORG_DOMAINS = new Set(["getonyx.ai", "aixccelerate.com"]);

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
  if (ORG_DOMAINS.has(domain)) {
    return { allowed: true, reason: "org-domain" };
  }

  // Strip wrapping again for the literal-match contact lookup.
  const m = fromAddress.match(/<([^>]+)>/);
  const clean = (m ? m[1] : fromAddress).trim().toLowerCase();

  const admin = createSupabaseAdmin();
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
