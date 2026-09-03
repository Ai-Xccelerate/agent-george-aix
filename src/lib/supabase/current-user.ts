import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "./admin";
import { checkCoreAccess, CoreAccessError } from "@/lib/aix-core/access";
import { ensureTenantRows, normalizeClerkRole } from "@/lib/aix-core/jit-mirror";

export type CurrentUser = {
  id: string; // Clerk user id
  email: string | null;
  fullName: string | null;
  timezone: string | null;
  locale: string | null;
  orgId: string; // LOCAL org uuid (mirror of the Clerk org)
  orgName: string;
  role: string;
};


/**
 * The expensive tail of identity resolution, cached per (user, org) for 60s.
 *
 * WHY THIS IS THE SLOWEST THING IN THE APP
 * getCurrentUser runs before every authenticated page render. Profiling on
 * 2026-09-02 ruled out the two obvious suspects: database execution is
 * 0.03-0.07ms per query, and no page's bundle is an outlier. What was left is
 * this function, which on every single render made two uncached calls to the
 * Clerk Backend API — `currentUser()` and `getOrganization()` — and then five
 * database round trips through the JIT mirror, three of them writes.
 *
 * Two cross-internet round trips and three writes, in sequence, before the page
 * begins its own work. That is why the whole UI felt slow rather than one
 * screen: it is not on the customer page, it is in front of every page.
 *
 * WHAT IS CACHED AND WHAT IS NOT
 * Only the tail: the Clerk profile, the org display name, and the mirrored
 * tenant rows. The session check (`auth()`) is local and stays on every call,
 * and the Core entitlement gate keeps its own ≤60s cache and its own
 * fail-closed behaviour — this does not widen that window.
 *
 * WHY 60 SECONDS
 * The number already used by `checkCoreAccess`, `resolveTenantProcess` and
 * `identity.ts`. Matching it means one staleness window to reason about instead
 * of four. The cost is that a display-name or role change can take a minute to
 * appear, which is the same deal already accepted for entitlement.
 *
 * FAILURES ARE NOT CACHED
 * Only a fully resolved user goes in. A transient Clerk hiccup or a mirror
 * error must not be remembered for a minute.
 *
 * ROLE IS DELIBERATELY NOT CACHED
 * It comes from the `org_members` row, not from the Clerk claim, because the
 * mirror upserts with ignoreDuplicates to preserve a role set in Settings →
 * Users. So it is the one value here that gates permissions AND is changed
 * inside this app — caching it would let a revoked admin keep admin for a
 * minute. It is re-read on every call: one indexed single-row lookup, measured
 * at ~0.05ms server-side, against the five round trips this avoids.
 */
const IDENTITY_TTL_MS = 60_000;

type CachedIdentity = {
  email: string | null;
  fullName: string | null;
  orgId: string;
  orgName: string;
};

const identityCache = new Map<string, { value: CachedIdentity; at: number }>();

/** Test seam, and the hook for "the org was just renamed, show it now". */
export function clearCurrentUserCache(key?: string): void {
  if (key) identityCache.delete(key);
  else identityCache.clear();
}

/**
 * Server-side identity + tenant resolution under AIX Core auth.
 *
 * Flow: verify the Clerk session → enforce Core /access (fail-closed) →
 * JIT-mirror the local org/membership rows → return the local tenant context.
 *
 * Returns null when there's no Clerk session or no active Clerk org (the
 * middleware/layout redirect to sign-in handles that). Throws CoreAccessError
 * when Core denies or is unavailable so the app layout can render the denied
 * screen — allowed users never see the throw (checkCoreAccess returns ok, and
 * its ≤60s cache keeps repeat calls cheap).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { userId: clerkUserId, orgId: clerkOrgId, orgRole, orgSlug, getToken } = await auth();
  if (!clerkUserId) return null; // not signed in
  if (!clerkOrgId) return null; // no active org selected yet

  const token = await getToken();
  if (!token) return null;

  // Core entitlement gate — before any tenant-row creation.
  const outcome = await checkCoreAccess(clerkUserId, token);
  if (!outcome.ok) throw new CoreAccessError(outcome);

  // Everything below this line is the expensive tail. One entry per (user, org)
  // per minute, rather than two Clerk API calls and three writes per render.
  const cacheKey = `${clerkUserId}:${clerkOrgId}`;
  const cached = identityCache.get(cacheKey);
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) {
    // Role stays live — see the note above. Everything else is a minute old.
    const fresh = await createSupabaseAdmin()
      .from("org_members")
      .select("role")
      .eq("org_id", cached.value.orgId)
      .eq("user_id", clerkUserId)
      .maybeSingle();

    // No membership row means access was revoked while the entry was warm.
    // Drop it and fall through to a full resolve, which fails closed properly.
    if (fresh.data?.role) {
      return {
        id: clerkUserId,
        email: cached.value.email,
        fullName: cached.value.fullName,
        timezone: null,
        locale: null,
        orgId: cached.value.orgId,
        orgName: cached.value.orgName,
        role: fresh.data.role as string,
      };
    }
    identityCache.delete(cacheKey);
  }

  const profile = await currentUser();
  const email = profile?.primaryEmailAddress?.emailAddress ?? null;
  const fullName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || null;

  // Clerk's auth() gives the slug but not the display name, and the slug is a
  // machine string — "amit-s-organization-1777976704412504541". Shown in George's
  // UI it looks like a different organisation from the one Core displays, and it
  // feeds the email signature, so a slug would go out in customer mail.
  // Best-effort: a Clerk hiccup must not block sign-in.
  let clerkOrgName: string | null = null;
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId: clerkOrgId });
    clerkOrgName = org?.name?.trim() || null;
  } catch {
    // Fall back to the slug, as before.
  }

  const admin = createSupabaseAdmin();
  const { orgId, orgName, role } = await ensureTenantRows(admin, {
    clerkUserId,
    clerkOrgId,
    orgRole: normalizeClerkRole(orgRole),
    orgSlug,
    clerkOrgName,
    email,
    fullName,
  });

  // Cached only once fully resolved. A partial or failed resolution must not be
  // remembered — the next request should retry, not inherit the failure.
  identityCache.set(cacheKey, {
    value: { email, fullName, orgId, orgName },
    at: Date.now(),
  });

  return {
    id: clerkUserId,
    email,
    fullName,
    timezone: null,
    locale: null,
    orgId,
    orgName,
    role,
  };
}
