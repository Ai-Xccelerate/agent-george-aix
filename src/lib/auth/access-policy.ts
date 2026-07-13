/**
 * Access policy for Agent George — domain allowlist only.
 *
 * Under AIX Core auth, identity, org membership, and per-agent entitlement are
 * owned by Clerk → Core (see `src/lib/aix-core/*`). George no longer admits
 * users itself; the old `admitUser` / invite-accept flow was removed with the
 * Supabase-auth migration. What remains here is the email-domain guard the
 * admin invite UI still uses to reject out-of-org addresses before they reach
 * Core.
 */

export const ALLOWED_DOMAINS = ["getonyx.ai", "aixccelerate.com"] as const;
export const ONYX_ORG_ID = "00000000-0000-0000-0000-000000000001";

/** Local dev / staging only — set NEXT_PUBLIC_OPEN_SIGNUP=true in .env.local */
export function isOpenSignup(): boolean {
  return process.env.NEXT_PUBLIC_OPEN_SIGNUP === "true";
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (isOpenSignup() && email?.includes("@")) return true;
  const d = emailDomain(email);
  return !!d && (ALLOWED_DOMAINS as readonly string[]).includes(d);
}
