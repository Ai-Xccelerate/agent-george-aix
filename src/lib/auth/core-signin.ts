/**
 * Where an unauthenticated visitor signs in.
 *
 * Platform rule: on a deployed *.aiworkforce.md domain George does NOT host its
 * own sign-in — it hands off to AIX Core's shared login, and the shared Clerk
 * session carries the user back (same cookie domain). On localhost there is no
 * shared cookie (different root domain), so we render George's embedded Clerk
 * widget instead — redirecting to Core from localhost would never return a
 * usable session and would loop.
 *
 * Precedence:
 *   1. An explicit absolute NEXT_PUBLIC_CLERK_SIGN_IN_URL wins (manual override).
 *   2. Any non-localhost host → AIX Core's /login (from NEXT_PUBLIC_CORE_URL).
 *   3. localhost / no Core configured → null (render the embedded widget).
 *
 * Returns the absolute Core sign-in URL to redirect to, or null to embed.
 * Deliberately does NOT require NEXT_PUBLIC_CLERK_SIGN_IN_URL to be set per
 * environment — staging/prod redirect to Core off NEXT_PUBLIC_CORE_URL alone.
 */
export function coreSignInUrl(host: string | null | undefined): string | null {
  const explicit = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
  if (explicit && /^https?:\/\//.test(explicit)) {
    return explicit;
  }

  const h = (host ?? "").toLowerCase();
  const isLocal =
    h.startsWith("localhost") ||
    h.startsWith("127.0.0.1") ||
    h.startsWith("[::1]") ||
    h.startsWith("0.0.0.0");
  if (isLocal) {
    return null;
  }

  const core = process.env.NEXT_PUBLIC_CORE_URL?.replace(/\/$/, "");
  return core ? `${core}/login` : null;
}
