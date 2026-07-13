/**
 * George's email identity + the domains treated as "internal" (the deploying
 * org's own team — recipients George may email without human review).
 *
 * Configurable per deployment via env so George isn't hardcoded to any one org:
 *   - GEORGE_EMAIL             the mailbox George operates from (matches the
 *                              Composio-connected Outlook account)
 *   - GEORGE_INTERNAL_DOMAINS  comma-separated internal domains
 *
 * Defaults target the current AIX deployment. (Previously hardcoded to
 * agent.george@getonyx.ai / getonyx.ai from the original Onyx build.)
 */

export const GEORGE_ADDRESS =
  process.env.GEORGE_EMAIL?.trim() || "manasa@aixccelerate.com";

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
