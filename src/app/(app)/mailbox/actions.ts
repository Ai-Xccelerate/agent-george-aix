"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callAction } from "@/lib/composio/client";

/**
 * Delete an email — moves it to Outlook's Deleted Items (recoverable there) and
 * drops it from the local mirror. We move rather than hard-delete so a misclick
 * is recoverable; the next delta sync also reconciles it.
 */
export async function deleteEmailAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const externalId = String(formData.get("external_id") ?? "");
  if (!externalId) return;

  const res = await callAction("OUTLOOK_BATCH_MOVE_MESSAGES", user.orgId, {
    message_ids: [externalId],
    destination_id: "deleteditems",
  });
  if (!res.ok) {
    console.error("[mailbox] delete failed", { externalId, error: res.error });
    return; // leave the row in place so it's clear nothing was deleted
  }

  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("email_messages")
    .delete()
    .eq("org_id", user.orgId)
    .eq("external_id", externalId);
  if (error) {
    console.error("[mailbox] local delete failed", { externalId, error: error.message });
  }

  revalidatePath("/mailbox");
}

/** Toggle a teammate's flag on an email — a signal George reads. Local only. */
export async function toggleFlagAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const externalId = String(formData.get("external_id") ?? "");
  if (!externalId) return;
  const flagged = formData.get("flagged") === "true";

  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("email_messages")
    .update({ flagged })
    .eq("org_id", user.orgId)
    .eq("external_id", externalId);
  if (error) throw new Error(`Could not update flag: ${error.message}`);

  revalidatePath("/mailbox");
}
