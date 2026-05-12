/**
 * Access policy for Agent George.
 *
 * Rules:
 *  - Only emails ending in one of `ALLOWED_DOMAINS` may authenticate.
 *  - There is no self-signup. The only way an account becomes a member of
 *    an org is:
 *      1. An existing org_members row (returning user), OR
 *      2. A `pending` invite issued by an admin/owner of that org.
 *  - First-bootstrap exception: if an Onyx org has ZERO members, the first
 *    allowlisted user to sign in becomes the owner. This handles the
 *    initial setup; once at least one member exists, invite-only kicks in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const ALLOWED_DOMAINS = ["getonyx.ai", "aixccelerate.com"] as const;
export const ONYX_ORG_ID = "00000000-0000-0000-0000-000000000001";

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const d = emailDomain(email);
  return !!d && (ALLOWED_DOMAINS as readonly string[]).includes(d);
}

export type AdmissionResult =
  | { ok: true; role: string; orgId: string; fullName: string | null; reason: "existing_member" | "invite_accepted" | "bootstrap_owner" }
  | { ok: false; reason: "domain_blocked" | "no_invite" };

/**
 * Decide if a freshly-authed user is allowed into the system, and which
 * org/role they join. Call with the service-role admin client.
 *
 * Side effects on success: inserts org_members and marks the invite accepted.
 */
export async function admitUser(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  fullNameFromMetadata: string | null,
): Promise<AdmissionResult> {
  if (!isAllowedEmail(email)) {
    return { ok: false, reason: "domain_blocked" };
  }

  // 1. Already a member? Done.
  const existing = await admin
    .from("org_members")
    .select("org_id, role, full_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.data) {
    return {
      ok: true,
      reason: "existing_member",
      orgId: existing.data.org_id,
      role: existing.data.role,
      fullName: existing.data.full_name ?? fullNameFromMetadata,
    };
  }

  // 2. Pending invite? Accept it.
  const invite = await admin
    .from("invites")
    .select("id, org_id, role, full_name, expires_at")
    .eq("status", "pending")
    .ilike("email", email ?? "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (invite.data) {
    if (new Date(invite.data.expires_at).getTime() < Date.now()) {
      await admin.from("invites").update({ status: "expired" }).eq("id", invite.data.id);
      return { ok: false, reason: "no_invite" };
    }

    const fullName = invite.data.full_name ?? fullNameFromMetadata;
    await admin.from("org_members").insert({
      org_id: invite.data.org_id,
      user_id: userId,
      role: invite.data.role,
      full_name: fullName,
      email,
    });
    await admin
      .from("invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.data.id);

    return {
      ok: true,
      reason: "invite_accepted",
      orgId: invite.data.org_id,
      role: invite.data.role,
      fullName,
    };
  }

  // 3. Bootstrap: if Onyx has zero members and the email is allowlisted, make them owner.
  const { count: onyxCount } = await admin
    .from("org_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", ONYX_ORG_ID);

  if ((onyxCount ?? 0) === 0) {
    await admin.from("org_members").insert({
      org_id: ONYX_ORG_ID,
      user_id: userId,
      role: "owner",
      full_name: fullNameFromMetadata,
      email,
    });
    return {
      ok: true,
      reason: "bootstrap_owner",
      orgId: ONYX_ORG_ID,
      role: "owner",
      fullName: fullNameFromMetadata,
    };
  }

  return { ok: false, reason: "no_invite" };
}
