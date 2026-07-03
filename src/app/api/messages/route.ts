import { NextRequest } from "next/server";
import { after } from "next/server";
import { ActivityTypes, type Activity } from "botbuilder";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { runTeamsActivity } from "@/lib/teams/adapter";
import { processTeamsEvent } from "@/lib/teams/process-event";
import { isFromAllowedTenant } from "@/lib/teams/tenant-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Bot Framework messaging endpoint for the Onyx Teams bot (docs/BACKLOG.md
 * #31). Azure Bot Service POSTs every Teams activity here.
 *
 * Flow:
 *   1. Tenant gate: reject anything not from the Onyx AAD tenant — this IS
 *      the allowlist for this surface, no Supabase session exists here.
 *   2. Authenticate the Bot Framework JWT and run inside the resulting turn
 *      context just long enough to send a "typing" ack — proves the caller
 *      really is Azure Bot Service before we do anything else.
 *   3. Persist the activity to `agent_events` (source:"teams") for the async
 *      processor, idempotent via the same (org_id, source, source_event_id)
 *      unique index the Composio webhook uses.
 *   4. Return 200 fast; `after()` hands off to `processTeamsEvent`, which
 *      runs George and replies proactively once he's done.
 */
export async function POST(req: NextRequest) {
  let activity: Activity;
  try {
    activity = (await req.json()) as Activity;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const teamsOrgId = process.env.TEAMS_ORG_ID;
  if (!teamsOrgId) {
    console.error("[teams webhook] TEAMS_ORG_ID unset — rejecting.");
    return new Response("not configured", { status: 500 });
  }

  if (!isFromAllowedTenant(activity, process.env.TEAMS_ALLOWED_TENANT_ID)) {
    console.warn("[teams webhook] rejected — tenant mismatch", {
      activityId: activity.id,
    });
    return new Response("forbidden", { status: 403 });
  }

  const authHeader = req.headers.get("authorization") ?? "";

  try {
    // Runs inside an authenticated turn context so the typing ack rides on
    // the same verified credentials as everything else in this turn.
    await runTeamsActivity(authHeader, activity, async (turnContext) => {
      if (activity.type === ActivityTypes.Message) {
        await turnContext.sendActivity({ type: ActivityTypes.Typing });
      }
    });
  } catch (err) {
    console.error("[teams webhook] auth/processing failed", err);
    return new Response("unauthorized", { status: 401 });
  }

  // Only inbound text messages go to George — conversationUpdate, typing,
  // installationUpdate, etc. have nothing for him to act on.
  if (activity.type !== ActivityTypes.Message || !activity.text?.trim()) {
    return new Response("ok", { status: 200 });
  }

  const admin = createSupabaseAdmin();
  const insert = await admin
    .from("agent_events")
    .insert({
      org_id: teamsOrgId,
      source: "teams",
      source_event_id: activity.id ?? null,
      event_type: "TEAMS_MESSAGE",
      payload: activity as unknown as Record<string, unknown>,
      status: "pending",
    })
    .select("id")
    .single();

  if (insert.error) {
    // 23505 = unique violation = a retried delivery we already accepted.
    if (insert.error.code === "23505") {
      return new Response("ok (duplicate)", { status: 200 });
    }
    console.error("[teams webhook] failed to persist event", insert.error);
    return new Response("persist failed", { status: 500 });
  }

  const eventId = insert.data.id as string;

  after(async () => {
    try {
      await processTeamsEvent(eventId);
    } catch (err) {
      console.error("[teams webhook] processTeamsEvent threw", { eventId, err });
    }
  });

  return new Response("ok", { status: 200 });
}
