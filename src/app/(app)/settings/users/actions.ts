"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { isAllowedEmail } from "@/lib/auth/access-policy";
import { type ActionResult, requireAdmin } from "@/lib/actions";

const InviteSchema = z.object({
  first_name: z.string().min(1).max(60),
  last_name: z.string().min(1).max(60),
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  role: z.enum(["admin", "csm", "sales", "viewer"]),
});

export type { ActionResult } from "@/lib/actions";

export async function inviteUserAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const parsed = InviteSchema.safeParse({
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid invite." };
  }
  const { first_name, last_name, email, role } = parsed.data;

  if (!isAllowedEmail(email)) {
    return {
      error:
        "Only emails at getonyx.ai or aixccelerate.com can be invited.",
    };
  }

  const fullName = `${first_name} ${last_name}`.trim();
  const admin = createSupabaseAdmin();

  // Don't double-invite an existing member.
  const existing = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", user.orgId)
    .ilike("email", email)
    .maybeSingle();
  if (existing.data) {
    return { error: `${email} is already a member.` };
  }

  // Insert the pending invite row (the unique partial index protects against
  // duplicates within the same org).
  const inviteRow = await admin
    .from("invites")
    .insert({
      org_id: user.orgId,
      email,
      full_name: fullName,
      role,
      invited_by: user.id,
    })
    .select("id")
    .single();
  if (inviteRow.error) {
    return {
      error: inviteRow.error.message.includes("invites_unique_pending")
        ? `There's already a pending invite for ${email}.`
        : inviteRow.error.message,
    };
  }

  // Send the actual invite email via Supabase Auth admin.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${(await headers()).get("x-forwarded-proto") ?? "http"}://${(await headers()).get("host")}`;
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, invited_role: role },
    redirectTo: `${origin}/auth/callback`,
  });
  if (invite.error) {
    // Roll back the invite row so it doesn't sit as a ghost.
    await admin.from("invites").delete().eq("id", inviteRow.data.id);
    return { error: `Couldn't send invite: ${invite.error.message}` };
  }

  revalidatePath("/settings/users");
  return { info: `Invite sent to ${email}.` };
}

export async function resendInviteAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const inviteId = String(formData.get("invite_id") ?? "");
  if (!inviteId) return { error: "Missing invite." };

  const admin = createSupabaseAdmin();
  const invite = await admin
    .from("invites")
    .select("email, full_name, role")
    .eq("id", inviteId)
    .eq("org_id", user.orgId)
    .eq("status", "pending")
    .maybeSingle();
  if (invite.error || !invite.data) {
    return { error: "Invite not found or no longer pending." };
  }
  const { email, full_name, role } = invite.data;

  // Supabase won't re-invite an address that already has an auth user, and the
  // first send already created one. Remove that stale, unconfirmed user (safe —
  // they never signed in and have no membership) so a fresh invite + email can
  // be minted. Refuse if they've actually confirmed (they'd be a member).
  const list = await admin.auth.admin.listUsers({ perPage: 200 });
  if (list.error) return { error: list.error.message };
  const existing = list.data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) {
    // Gate on the actual org_members row, not email_confirmed_at: the old
    // broken verify flow could mark an email confirmed without ever creating a
    // membership, so a confirmed-but-not-member user must still be resendable.
    const member = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", user.orgId)
      .eq("user_id", existing.id)
      .maybeSingle();
    if (member.data) {
      return { error: `${email} is already a member.` };
    }
    // Delete the stale auth user (mints a fresh token and kills the old link).
    const del = await admin.auth.admin.deleteUser(existing.id);
    if (del.error) return { error: `Couldn't reset the old invite: ${del.error.message}` };
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${(await headers()).get("x-forwarded-proto") ?? "http"}://${(await headers()).get("host")}`;
  const sent = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name, invited_role: role },
    redirectTo: `${origin}/auth/callback`,
  });
  if (sent.error) return { error: `Couldn't resend: ${sent.error.message}` };

  revalidatePath("/settings/users");
  return { info: `Invite re-sent to ${email}.` };
}

export async function revokeInviteAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const inviteId = String(formData.get("invite_id") ?? "");
  if (!inviteId) return;
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("org_id", auth.user.orgId)
    .eq("status", "pending");
  if (error) throw new Error(`Could not revoke invite: ${error.message}`);
  revalidatePath("/settings/users");
}

export async function changeRoleAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const targetUserId = String(formData.get("user_id") ?? "");
  const newRole = String(formData.get("role") ?? "");
  const allowed = ["admin", "csm", "sales", "viewer"];
  if (!targetUserId || !allowed.includes(newRole)) return;
  // Don't allow changing owner role here (safety net).
  const admin = createSupabaseAdmin();
  const target = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", auth.user.orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (target.data?.role === "owner") return;
  const { error } = await admin
    .from("org_members")
    .update({ role: newRole })
    .eq("org_id", auth.user.orgId)
    .eq("user_id", targetUserId);
  if (error) throw new Error(`Could not change role: ${error.message}`);
  revalidatePath("/settings/users");
}

export async function removeMemberAction(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return;
  const targetUserId = String(formData.get("user_id") ?? "");
  if (!targetUserId || targetUserId === auth.user.id) return; // can't remove self via this path
  const admin = createSupabaseAdmin();
  const target = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", auth.user.orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (target.data?.role === "owner") return;
  const { error } = await admin
    .from("org_members")
    .delete()
    .eq("org_id", auth.user.orgId)
    .eq("user_id", targetUserId);
  if (error) throw new Error(`Could not remove member: ${error.message}`);
  revalidatePath("/settings/users");
}
