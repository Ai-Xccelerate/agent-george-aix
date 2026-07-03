/**
 * Processor for one `agent_events` row sourced from Teams. Mirrors the shape
 * of `src/lib/agent/process-event.ts` (claim → frame → run George → persist
 * → mark done), but this is an internal-staff chat surface like `/api/chat`,
 * not the Outlook/customer-email pipeline — no customer resolution, no send
 * policy beyond the conservative default.
 *
 * Multi-turn continuity: unlike the email path (a fresh `agent_sessions` row
 * per inbound message), a Teams conversation is an ongoing back-and-forth,
 * so we look up the most recent session tied to this Teams conversation id
 * and resume its `sdk_session_id`. No schema change needed — the Teams
 * conversation id already lives in `agent_events.payload` (the raw activity
 * we stored on receipt), so we query that instead of adding a mapping column.
 */
import type { Activity, ConversationReference } from "botbuilder";
import { TurnContext } from "botbuilder";
import { runGeorgeAutonomous } from "@/lib/agent/run-autonomous";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { sendTeamsReply } from "./adapter";
import { extractConversationId } from "./tenant-gate";

type EventRow = {
  id: string;
  org_id: string;
  source: string;
  source_event_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  session_id: string | null;
};

export type ProcessTeamsEventResult =
  | { skipped: true; reason: "not_found" | "already_claimed" }
  | {
      skipped: false;
      sessionId: string | null;
      status: "processed" | "failed";
      error: string | null;
    };

const PROCESS_TIME_BUDGET_MS = 240_000;

export async function processTeamsEvent(
  eventId: string,
): Promise<ProcessTeamsEventResult> {
  const admin = createSupabaseAdmin();

  // 1) Atomic claim, same pattern as the Composio processor.
  const claim = await admin
    .from("agent_events")
    .update({ status: "processing", claimed_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "pending")
    .select(
      "id, org_id, source, source_event_id, event_type, payload, status, session_id",
    )
    .maybeSingle();

  if (claim.error) {
    return {
      skipped: false,
      sessionId: null,
      status: "failed",
      error: claim.error.message,
    };
  }
  if (!claim.data) {
    const probe = await admin
      .from("agent_events")
      .select("id")
      .eq("id", eventId)
      .maybeSingle();
    return { skipped: true, reason: probe.data ? "already_claimed" : "not_found" };
  }
  const event = claim.data as EventRow;
  const activity = event.payload as unknown as Activity;
  const conversationId = extractConversationId(activity);

  // 2) Resume the most recent session tied to this Teams conversation, if any.
  let sessionId: string | null = null;
  let resumeSdkSessionId: string | null = null;
  if (conversationId) {
    const priorEvent = await admin
      .from("agent_events")
      .select("session_id")
      .eq("org_id", event.org_id)
      .eq("source", "teams")
      .eq("payload->conversation->>id", conversationId)
      .not("session_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const priorSessionId = priorEvent.data?.session_id as string | undefined;
    if (priorSessionId) {
      const priorSession = await admin
        .from("agent_sessions")
        .select("id, sdk_session_id")
        .eq("id", priorSessionId)
        .maybeSingle();
      if (priorSession.data) {
        sessionId = priorSession.data.id as string;
        resumeSdkSessionId = (priorSession.data.sdk_session_id as string | null) ?? null;
      }
    }
  }

  const senderName =
    (activity.from as { name?: string } | undefined)?.name ?? "Someone";
  const rawText = activity.text ?? "";
  // Strip the @mention text Teams leaves in group/team-scope messages.
  const messageText = TurnContext.removeRecipientMention(activity).trim() || rawText;

  if (!sessionId) {
    const sessionInsert = await admin
      .from("agent_sessions")
      .insert({
        org_id: event.org_id,
        user_id: null,
        channel: "teams",
        title: `Teams: ${senderName}`.slice(0, 120),
      })
      .select("id")
      .single();
    if (sessionInsert.error || !sessionInsert.data) {
      const errMsg =
        sessionInsert.error?.message ?? "could not create agent_sessions row";
      await admin
        .from("agent_events")
        .update({ status: "failed", error: errMsg, processed_at: new Date().toISOString() })
        .eq("id", event.id);
      return { skipped: false, sessionId: null, status: "failed", error: errMsg };
    }
    sessionId = sessionInsert.data.id as string;
  }

  // Link this event to the session immediately so the conversation-id lookup
  // above finds it on the next inbound Teams message.
  await admin.from("agent_events").update({ session_id: sessionId }).eq("id", event.id);

  const seedInsert = await admin.from("agent_messages").insert({
    session_id: sessionId,
    role: "user",
    content: `**${senderName} (Teams)**\n\n${messageText}`,
  });
  if (seedInsert.error) {
    console.error("[teams process-event] seed message insert failed", {
      sessionId,
      error: seedInsert.error.message,
    });
  }

  // 3) Run George. emailSendPolicy "none" — draft-only, matches the
  //    "never auto-send" policy; a human is on the other end of the Teams
  //    thread but this run is async, not a live chat turn.
  const result = await runGeorgeAutonomous({
    orgId: event.org_id,
    userPrompt: messageText,
    timeBudgetMs: PROCESS_TIME_BUDGET_MS,
    clientAppTag: "agent-george-teams/0.1",
    sessionId,
    resumeSdkSessionId,
    emailSendPolicy: "none",
  });

  const replyText = result.summary ?? "(George didn't produce a reply this time.)";
  const assistantInsert = await admin.from("agent_messages").insert({
    session_id: sessionId,
    role: "assistant",
    content: replyText,
  });
  if (assistantInsert.error) {
    console.error("[teams process-event] assistant message insert failed", {
      sessionId,
      error: assistantInsert.error.message,
    });
  }

  if (result.sdkSessionId) {
    await admin
      .from("agent_sessions")
      .update({ sdk_session_id: result.sdkSessionId })
      .eq("id", sessionId);
  }

  const finalStatus = result.status === "succeeded" ? "processed" : "failed";
  await admin
    .from("agent_events")
    .update({
      status: finalStatus,
      session_id: sessionId,
      error: result.error,
      processed_at: new Date().toISOString(),
    })
    .eq("id", event.id);

  // 4) Reply into Teams — proactive send via the stored conversation
  //    reference, regardless of run status, so the user isn't left hanging.
  try {
    const conversationReference: Partial<ConversationReference> =
      TurnContext.getConversationReference(activity);
    await sendTeamsReply(conversationReference, replyText);
  } catch (err) {
    console.error("[teams process-event] sendTeamsReply failed", {
      sessionId,
      err,
    });
  }

  return { skipped: false, sessionId, status: finalStatus, error: result.error };
}
