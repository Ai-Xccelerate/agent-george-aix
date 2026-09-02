/**
 * What happens when a customer replies to an onboarding email.
 *
 * THE POINT OF THE WHOLE FEATURE IS THIS STEP
 * Sending is the easy half. A sequencer can send. What makes this a customer
 * success teammate rather than a campaign tool is that the answer changes the
 * record: a reply is read, and what it says lands in the account as state the
 * next run can act on.
 *
 * Four questions, four existing primitives:
 *
 *   Did they answer the ask?   -> update_onboarding_step
 *   Did they name a blocker?   -> create_objective, with an owner and a date
 *   How did they sound?        -> record_health_check
 *   Does a person need to act? -> raise_decision
 *
 * NO AUTO-REPLY. Not because writing one would be hard, but because the loop
 * has never run end to end with a real customer. Closing it before watching it
 * open means the first time anyone sees George's judgement about a reply is
 * after he has already answered it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantProcess } from "./tenant-process";

export type MatchedTouchpoint = {
  id: string;
  orgId: string;
  customerId: string;
  planId: string;
  touchpointKey: string;
  sentAt: string | null;
  recipientEmail: string | null;
};

/**
 * Find the onboarding touchpoint an inbound message is answering.
 *
 * Matched on thread, not on subject or sender. A subject line survives being
 * edited, forwarded and re-used; "from this address" matches every message that
 * contact ever sends. The thread is the only identifier that means "this is a
 * reply to that specific email".
 *
 * Returns null when the message is not part of an onboarding conversation,
 * which is the common case — most inbound mail is not a reply to a touchpoint,
 * and treating it as one would attribute unrelated news to a plan step.
 */
export async function matchTouchpointForReply(
  db: SupabaseClient,
  orgId: string,
  threadId: string | null,
): Promise<MatchedTouchpoint | null> {
  if (!threadId) return null;

  const { data } = await db
    .from("onboarding_touchpoint")
    .select("id, org_id, customer_id, plan_id, touchpoint_key, sent_at, recipient_email")
    .eq("org_id", orgId)
    .eq("thread_id", threadId)
    .in("status", ["sent", "silent", "replied"])
    .order("sent_at", { ascending: false })
    .limit(1);

  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: String(row.id),
    orgId: String(row.org_id),
    customerId: String(row.customer_id),
    planId: String(row.plan_id),
    touchpointKey: String(row.touchpoint_key),
    sentAt: (row.sent_at as string | null) ?? null,
    recipientEmail: (row.recipient_email as string | null) ?? null,
  };
}

/**
 * Record that the customer answered.
 *
 * Written before George reads anything. The fact of a reply is not a judgement
 * and should not wait on one — if the run then fails, times out, or produces
 * nothing useful, the account must still show that this person came back to us,
 * or the silence sweep will chase somebody who already answered.
 */
export async function markReplied(
  db: SupabaseClient,
  touchpointId: string,
  repliedAt: string,
): Promise<void> {
  await db
    .from("onboarding_touchpoint")
    .update({
      status: "replied",
      replied_at: repliedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", touchpointId)
    // Only the first reply counts. A thread with four messages in it is one
    // customer answering, not four separate re-engagements.
    .is("replied_at", null);
}

/**
 * The framing George reads when a reply lands.
 *
 * Deliberately a set of questions rather than instructions to summarise. A
 * summary is prose nobody queries; the questions map one-to-one onto tools, so
 * the output of thinking about them is a changed record.
 */
export function buildReplyFramingPrompt(args: {
  process: TenantProcess;
  touchpointKey: string;
  customerName: string;
  customerId: string;
  from: string;
  subject: string | null;
  body: string;
}): string {
  const tp = args.process.touchpoints.find((t) => t.key === args.touchpointKey);

  return [
    `${args.customerName} has replied to the "${args.touchpointKey}" email in their onboarding.`,
    "",
    tp ? `You asked them: ${tp.ask}` : "",
    "",
    `From: ${args.from}`,
    args.subject ? `Subject: ${args.subject}` : "",
    "",
    "Their reply:",
    "---",
    args.body.slice(0, 8000),
    "---",
    "",
    "# What to do with it",
    "",
    "Read it and update the account. Four questions — answer the ones the reply",
    "actually answers, and leave the others alone rather than inventing a finding:",
    "",
    "1. **Did they do the thing you asked, or say they will?** If a step moved,",
    `   update it with update_onboarding_step (customer id \`${args.customerId}\`).`,
    "   Do not mark a step complete on an intention — \"we'll get to it Friday\" is",
    "   a commitment, not a completion.",
    "",
    "2. **Did they name something blocking them?** create_objective, with who owns",
    "   it and a due date. A blocker with no owner and no date is a note, and notes",
    "   do not get chased. If they said when, use their date; if not, propose one.",
    "",
    "3. **How did they sound?** record_health_check if the tone or content tells you",
    "   something the account state does not already say. Frustration, silence about",
    "   the actual question, a new stakeholder appearing, an unprompted deadline —",
    "   those are signals. A pleasant acknowledgement is not.",
    "",
    "4. **Does a person need to decide something?** raise_decision. Anything",
    "   commercial, contractual, a complaint, a request you cannot meet, or anything",
    "   where being wrong would cost more than waiting.",
    "",
    "# Do not reply",
    "",
    "You are not writing back. Read, record, and stop. If the reply obviously needs",
    "an answer, raise a decision saying so and what you would send — a person sends",
    "it. This is deliberate: the loop has not been watched end to end yet, and",
    "answering before anyone has seen your judgement about a reply is the wrong",
    "order to earn that.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
