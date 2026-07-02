import { getCurrentUser, type CurrentUser } from "@/lib/supabase/current-user";

/**
 * Guard for server actions restricted to whoever can approve a domain
 * allowlist request — owner, admin, or CSM. Broader than requireAdmin
 * because domain approval is explicitly a CSM-or-admin decision, not an
 * admin-only one (mirrors the `can_approve_domains` RLS policy).
 */
export async function requireApprover(): Promise<
  { user: CurrentUser } | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };
  if (!["owner", "admin", "csm"].includes(user.role))
    return { error: "Only an owner, admin, or CSM can do that." };
  return { user };
}
