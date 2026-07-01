import { getCurrentUser, type CurrentUser } from "@/lib/supabase/current-user";

/**
 * Guard for admin-only server actions. Returns the authenticated user when
 * they hold the `owner` or `admin` role; otherwise returns an error string
 * suitable for surfacing in an `ActionResult`.
 */
export async function requireAdmin(): Promise<
  { user: CurrentUser } | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };
  if (user.role !== "owner" && user.role !== "admin")
    return { error: "Admins only." };
  return { user };
}
