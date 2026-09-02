"use server";

/**
 * Approving a decision that carries a draft.
 *
 * THE RULE: APPROVAL SENDS *THAT* DRAFT
 * Not "hand the instruction back to George and let him compose again". A human
 * read a specific piece of text and said yes to it; anything else means the
 * approved text and the sent text are two objects that merely tend to agree.
 * That gap is the 2026-08-20 shape — authorising an intent rather than an
 * artifact — and it is what `escalations.draft_id` exists to close.
 *
 * Nothing here composes, rewrites, or re-renders. It takes the id off the
 * escalation and sends it.
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { sendDraftGuarded } from "@/lib/agent/send-guarded";

export type ApproveResult = { ok: boolean; message: string };

/** Who may approve. Read-only roles see the queue and cannot act on it. */
const APPROVER_ROLES = new Set(["owner", "admin", "csm"]);

export async function approveAndSendAction(
  _state: ApproveResult | null,
  formData: FormData,
): Promise<ApproveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!APPROVER_ROLES.has(user.role)) {
    return { ok: false, message: "Your role cannot approve sends." };
  }

  const escalationId = String(formData.get("escalation_id") ?? "");
  if (!escalationId) return { ok: false, message: "Missing decision id." };

  const admin = createSupabaseAdmin();
  const { data: esc } = await admin
    .from("escalations")
    .select("id, draft_id, status, session_id, customer_id")
    .eq("org_id", user.orgId)
    .eq("id", escalationId)
    .maybeSingle();

  if (!esc) return { ok: false, message: "That decision no longer exists." };
  if (esc.status !== "open") {
    return { ok: false, message: "That decision has already been handled." };
  }

  // THE BINDING, CHECKED RATHER THAN ASSUMED.
  //
  // This is also what earns the chat ceiling below. The relaxed 15/hr limit is
  // for sends a human authorised one at a time; it is not a property of running
  // inside a server action. A decision with no draft cannot have been read and
  // approved as text, so it does not get the relaxed limit — it gets refused.
  const draftId = (esc.draft_id as string | null)?.trim();
  if (!draftId) {
    return {
      ok: false,
      message:
        "This decision does not carry a draft, so there is nothing to approve and send. " +
        "Resolve it instead, or ask George to draft the email.",
    };
  }

  const result = await sendDraftGuarded({
    db: admin,
    orgId: user.orgId,
    draftId,
    // Earned by the verified draft_id above, not by the code path.
    mode: "chat",
    actor: user.id,
    sessionId: (esc.session_id as string | null) ?? null,
    customerId: (esc.customer_id as string | null) ?? null,
    auditExtra: { via: "approval", escalation_id: esc.id, approved_by: user.id },
  });

  if (!result.ok) {
    // The refusal is the interesting outcome, so it is surfaced to the person
    // who clicked rather than swallowed into a log. The decision stays open:
    // a refused send is not a handled decision.
    return { ok: false, message: result.reason };
  }

  await admin
    .from("escalations")
    .update({
      status: "resolved",
      resolved_by: user.id,
      resolution: `Approved and sent by ${user.email ?? user.id}.`,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", esc.id);

  // Close the touchpoint too, so the account page and the silence sweep both
  // see a send rather than a draft still waiting.
  await admin
    .from("onboarding_touchpoint")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_message_id: result.messageId,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", user.orgId)
    .eq("escalation_id", esc.id);

  revalidatePath("/actions");
  revalidatePath("/mailbox");
  return {
    ok: true,
    message: `Sent to ${result.recipients.join(", ")}.`,
  };
}
