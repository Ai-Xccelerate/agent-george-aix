import { auth, currentUser } from "@clerk/nextjs/server";
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

  const profile = await currentUser();
  const email = profile?.primaryEmailAddress?.emailAddress ?? null;
  const fullName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || null;

  const admin = createSupabaseAdmin();
  const { orgId, orgName, role } = await ensureTenantRows(admin, {
    clerkUserId,
    clerkOrgId,
    orgRole: normalizeClerkRole(orgRole),
    orgSlug,
    email,
    fullName,
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
