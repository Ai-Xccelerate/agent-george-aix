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

/**
 * Send a draft from the mailbox Drafts folder. This is the ONLY human path for
 * sending an external email George prepared: George's own `send_email_draft`
 * tool always refuses drafts with external recipients (composio-tools.ts), so
 * an external send requires this explicit human click. Any authenticated org
 * member may send (matches existing chat-send behavior — no extra role gate).
 */
export async function sendMailboxDraftAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const externalId = String(formData.get("external_id") ?? "");
  if (!externalId) return;

  const admin = createSupabaseAdmin();

  // Only genuine drafts may be sent. Confirm the message really is in this org's
  // Drafts folder before touching Outlook — never "send" a received/sent item.
  const [{ data: draftsFolder }, { data: msg }] = await Promise.all([
    admin
      .from("mail_folders")
      .select("external_id")
      .eq("org_id", user.orgId)
      .ilike("display_name", "Drafts")
      .maybeSingle(),
    admin
      .from("email_messages")
      .select("external_id, folder_external_id")
      .eq("org_id", user.orgId)
      .eq("external_id", externalId)
      .maybeSingle(),
  ]);
  if (!msg || !draftsFolder || msg.folder_external_id !== draftsFolder.external_id) {
    return; // not a draft in this org — refuse silently
  }

  const res = await callAction("OUTLOOK_SEND_DRAFT", user.orgId, {
    messageId: externalId,
  });
  if (!res.ok) {
    console.error("[mailbox] send draft failed", { externalId, error: res.error });
    return;
  }

  // Sent — Outlook moves it out of Drafts (to Sent Items, with a new id). Drop
  // the local draft row so the UI is honest; the next delta sync re-adds it.
  await admin
    .from("email_messages")
    .delete()
    .eq("org_id", user.orgId)
    .eq("external_id", externalId);

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "email.sent",
    payload: { draft_id: externalId, via: "mailbox_human", confirmed_by: user.id },
  });

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
