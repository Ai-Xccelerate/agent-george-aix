"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/** Mark one of George's escalations resolved, from the dashboard Needs-you queue. */
export async function resolveEscalationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const admin = createSupabaseAdmin();
  await admin
    .from("escalations")
    .update({
      status: "resolved",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", user.orgId)
    .eq("status", "open");

  revalidatePath("/dashboard");
}
