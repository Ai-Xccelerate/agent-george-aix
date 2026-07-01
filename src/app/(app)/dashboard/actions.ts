"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

// Who may resolve/dismiss an escalation — must match the `canApprove` set the
// /actions page uses to render the buttons. UI hiding is not authorization; the
// action re-checks because it runs against the RLS-bypassing service client.
const APPROVER_ROLES = ["owner", "admin", "csm"];

/** Mark one of George's escalations resolved, from the dashboard Needs-you queue. */
export async function resolveEscalationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !APPROVER_ROLES.includes(user.role)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("escalations")
    .update({
      status: "resolved",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", user.orgId)
    .eq("status", "open");
  if (error) throw new Error(`Could not resolve escalation: ${error.message}`);

  revalidatePath("/dashboard");
  revalidatePath("/actions");
}

/** Discard (dismiss) an escalation — closed without action, off the queue. */
export async function discardEscalationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !APPROVER_ROLES.includes(user.role)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const admin = createSupabaseAdmin();
  await admin
    .from("escalations")
    .update({
      status: "dismissed",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", user.orgId)
    .eq("status", "open");

  revalidatePath("/dashboard");
  revalidatePath("/actions");
}
