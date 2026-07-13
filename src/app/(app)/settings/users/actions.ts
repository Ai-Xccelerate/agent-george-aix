"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/actions";

// Inviting teammates and granting them George access is owned by AIX Core
// (Clerk org invitations + per-agent assignment). George no longer sends its
// own invite emails — that path used Supabase Auth, which this app no longer
// uses. The actions below operate only on the local org_members mirror George
// reads for its own role-based gating (requireAdmin / requireApprover).

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
