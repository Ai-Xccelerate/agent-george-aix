import { admitUser } from "@/lib/auth/access-policy";
import { createSupabaseAdmin } from "./admin";
import { createSupabaseServer } from "./server";

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  timezone: string | null;
  locale: string | null;
  orgId: string;
  orgName: string;
  role: string;
};

/**
 * Server-side lookup of the signed-in user + their (first) org membership.
 * Returns null when not signed in OR when the user has no org row yet
 * (shouldn't happen after auth callbacks finish, but we handle it).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let membership = await loadMembership(supabase, user.id);

  // Authed but not yet in an org — admit on the fly (fixes open-signup gaps
  // and avoids a /dashboard ↔ /signin redirect loop).
  if (!membership) {
    const admin = createSupabaseAdmin();
    const verdict = await admitUser(
      admin,
      user.id,
      user.email ?? null,
      (user.user_metadata?.full_name as string | undefined) ?? null,
      supabase,
    );
    if (!verdict.ok) return null;
    membership = await loadMembership(supabase, user.id);
    if (!membership) return null;
  }

  return {
    id: user.id,
    email: membership.email ?? user.email ?? null,
    fullName:
      membership.full_name ??
      (user.user_metadata?.full_name as string | undefined) ??
      null,
    timezone: membership.timezone ?? null,
    locale: membership.locale ?? null,
    orgId: membership.org_id,
    orgName: membership.orgName ?? "AIX",
    role: membership.role,
  };
}

async function loadMembership(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
  userId: string,
) {
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, role, full_name, email, timezone, locale, orgs:org_id(name)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  return {
    ...membership,
    orgName: (membership.orgs as { name?: string } | null)?.name ?? "AIX",
  };
}
