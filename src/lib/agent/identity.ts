/**
 * George's email identity + the domains treated as "internal" (the deploying
 * org's own team — recipients George may email without human review).
 *
 * Configurable per deployment via env so George isn't hardcoded to any one org:
 *   - GEORGE_EMAIL             the mailbox George operates from
 *   - NYLAS_FROM_EMAIL         used when George has its own Nylas mailbox, so
 *                              the sending address and the advertised address
 *                              cannot drift apart
 *   - GEORGE_INTERNAL_DOMAINS  comma-separated internal domains
 *
 * THERE IS NO DEFAULT ADDRESS, DELIBERATELY
 * This used to fall back to a colleague's personal mailbox — first
 * agent.george@getonyx.ai from the original Onyx build, then a real person's
 * address. Because it feeds the customer-facing email signature, an unset
 * variable meant George told recipients to reply to a human who had never
 * agreed to it, and did so convincingly.
 *
 * Empty is the honest answer: callers omit the address rather than print
 * somebody else's. An incomplete signature is cosmetic; a confidently wrong one
 * costs trust.
 */

export const GEORGE_ADDRESS =
  process.env.GEORGE_EMAIL?.trim() || process.env.NYLAS_FROM_EMAIL?.trim() || "";

const configured = process.env.GEORGE_INTERNAL_DOMAINS
  ?.split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

export const INTERNAL_DOMAINS = new Set(
  (configured && configured.length ? configured : ["aixccelerate.com"])
    .concat((GEORGE_ADDRESS.split("@")[1] ?? "").toLowerCase())
    .filter(Boolean),
);

export function isInternalDomain(domain: string | null | undefined): boolean {
  return !!domain && INTERNAL_DOMAINS.has(domain.toLowerCase());
}

export function isInternalAddress(addr: string): boolean {
  return isInternalDomain(addr.split("@")[1]);
}
