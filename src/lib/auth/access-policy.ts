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

export type AdmissionResult =
  | { ok: true; role: string; orgId: string; fullName: string | null; reason: "existing_member" | "invite_accepted" | "bootstrap_owner" | "open_signup" }
  | { ok: false; reason: "domain_blocked" | "no_invite" };

async function insertOrgMember(
  clients: { admin: SupabaseClient; user?: SupabaseClient },
  row: {
    org_id: string;
    user_id: string;
    role: string;
    full_name: string | null;
    email: string | null;
  },
): Promise<boolean> {
  const rpcArgs = {
    p_org_id: row.org_id,
    p_user_id: row.user_id,
    p_role: row.role,
    p_full_name: row.full_name,
    p_email: row.email,
  };

  if (clients.user) {
    const { error } = await clients.user.from("org_members").insert(row);
    if (!error) return true;
    console.error("[admitUser] user-session insert failed", error.message);

    const { data: rpcOk, error: rpcErr } = await clients.user.rpc(
      "admit_org_member",
      rpcArgs,
    );
    if (!rpcErr && rpcOk) return true;
    if (rpcErr) console.error("[admitUser] user rpc failed", rpcErr.message);
  }

  const { data: adminRpcOk, error: adminRpcErr } = await clients.admin.rpc(
    "admit_org_member",
    rpcArgs,
  );
  if (!adminRpcErr && adminRpcOk) return true;
  if (adminRpcErr) console.error("[admitUser] admin rpc failed", adminRpcErr.message);

  const { error } = await clients.admin.from("org_members").insert(row);
  if (error) {
    console.error("[admitUser] admin insert failed", error.message);
    return false;
  }
  return true;
}

/**
 * Decide if a freshly-authed user is allowed into the system, and which
 * org/role they join. Pass the service-role admin client for reads/writes
 * that bypass RLS; pass `userClient` (the signed-in session) when available
 * so org_members self-insert works on local Supabase.
 *
 * Side effects on success: inserts org_members and marks the invite accepted.
 */
export async function admitUser(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  fullNameFromMetadata: string | null,
  userClient?: SupabaseClient,
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
    const inserted = await insertOrgMember({ admin, user: userClient }, {
      org_id: invite.data.org_id,
      user_id: userId,
      role: invite.data.role,
      full_name: fullName,
      email,
    });
    if (!inserted) return { ok: false, reason: "no_invite" };
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
    const inserted = await insertOrgMember({ admin, user: userClient }, {
      org_id: ONYX_ORG_ID,
      user_id: userId,
      role: "owner",
      full_name: fullNameFromMetadata,
      email,
    });
    if (!inserted) return { ok: false, reason: "no_invite" };
    return {
      ok: true,
      reason: "bootstrap_owner",
      orgId: ONYX_ORG_ID,
      role: "owner",
      fullName: fullNameFromMetadata,
    };
  }

  // 4. Local dev: auto-join the Onyx org without an invite.
  if (isOpenSignup()) {
    const inserted = await insertOrgMember({ admin, user: userClient }, {
      org_id: ONYX_ORG_ID,
      user_id: userId,
      role: "csm",
      full_name: fullNameFromMetadata,
      email,
    });
    if (!inserted) return { ok: false, reason: "no_invite" };
    return {
      ok: true,
      reason: "open_signup",
      orgId: ONYX_ORG_ID,
      role: "csm",
      fullName: fullNameFromMetadata,
    };
  }

  return { ok: false, reason: "no_invite" };
}
