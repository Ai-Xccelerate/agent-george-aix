import { NextRequest } from "next/server";
import { after } from "next/server";
import { Webhook, WebhookVerificationError } from "svix";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { processAgentEvent } from "@/lib/agent/process-event";
import { isSenderAllowed } from "@/lib/agent/sender-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Agentmail webhook landing pad. Unlike Composio's notify-then-fetch, the
 * full message (subject/from/text/html) is delivered inline.
 *
 * Flow:
 *   1. Verify Svix signature using AGENTMAIL_WEBHOOK_SECRET (whsec_...).
 *   2. Resolve the org. Single-tenant for now — first org row in the DB.
 *   3. Persist an agent_events row (source='agentmail') idempotently via
 *      the unique (org_id, source, source_event_id) index.
 *   4. Return 200 fast, hand off via after() to processAgentEvent which
 *      creates the email-channel session + seeded inbound message.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[agentmail webhook] AGENTMAIL_WEBHOOK_SECRET unset in production — rejecting.",
      );
      return new Response("missing secret", { status: 401 });
    }
    console.warn(
      "[agentmail webhook] AGENTMAIL_WEBHOOK_SECRET unset — accepting unsigned (dev only).",
    );
  }

  let body: AgentmailEnvelope;
  if (secret) {
    try {
      const wh = new Webhook(secret);
      const headers: Record<string, string> = {};
      for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
        const v = req.headers.get(name);
        if (v) headers[name] = v;
      }
      body = wh.verify(raw, headers) as AgentmailEnvelope;
    } catch (err) {
      const reason =
        err instanceof WebhookVerificationError ? err.message : "verify failed";
      console.error("[agentmail webhook] signature rejected", {
        reason,
        receivedHeaders: {
          "svix-id": req.headers.get("svix-id"),
          "svix-timestamp": req.headers.get("svix-timestamp"),
          "svix-signature": req.headers.get("svix-signature"),
        },
        bodyBytes: raw.length,
      });
      return new Response("invalid signature", { status: 401 });
    }
  } else {
    try {
      body = JSON.parse(raw) as AgentmailEnvelope;
    } catch {
      return new Response("invalid json", { status: 400 });
    }
  }

  const eventType = body.event_type ?? "unknown";
  const deliveryId = body.event_id ?? body.message?.message_id ?? null;
  const admin = createSupabaseAdmin();

  // Single-tenant resolution — pick the only (oldest) org row.
  const orgRow = await admin
    .from("orgs")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const orgId = orgRow.data?.id as string | undefined;
  if (!orgId) {
    console.error("[agentmail webhook] no orgs row found — cannot route");
    return new Response("ok", { status: 200 });
  }

  // Paper trail for every event regardless of whether we process it.
  await admin.from("audit_log").insert({
    org_id: orgId,
    actor: "agentmail",
    action: `webhook.${eventType}`,
    payload: {
      type: eventType,
      delivery_id: deliveryId,
      raw: body,
    },
  });

  const PROCESSABLE = new Set(["message.received"]);
  if (!PROCESSABLE.has(eventType)) {
    return new Response("ok", { status: 200 });
  }

  // Sender allowlist — drop spam at the door, keep the audit_log paper trail.
  const fromRaw = body.message?.from_;
  const fromAddress = Array.isArray(fromRaw) ? fromRaw[0] : fromRaw ?? null;
  const decision = await isSenderAllowed(orgId, fromAddress);
  if (!decision.allowed) {
    console.log("[agentmail webhook] dropped (allowlist)", {
      from: fromAddress,
      reason: decision.reason,
      subject: body.message?.subject,
    });
    return new Response("ok", { status: 200 });
  }

  const insert = await admin
    .from("agent_events")
    .insert({
      org_id: orgId,
      source: "agentmail",
      source_event_id: deliveryId,
      event_type: eventType,
      payload: body as unknown as Record<string, unknown>,
      status: "pending",
    })
    .select("id")
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") {
      return new Response("ok (duplicate)", { status: 200 });
    }
    console.error("[agentmail webhook] failed to persist event", insert.error);
    return new Response("ok", { status: 200 });
  }

  const eventId = insert.data.id as string;

  after(async () => {
    try {
      await processAgentEvent(eventId);
    } catch (err) {
      console.error("[agentmail webhook] processAgentEvent threw", {
        eventId,
        err,
      });
    }
  });

  return new Response("ok", { status: 200 });
}

type AgentmailMessage = {
  message_id?: string;
  thread_id?: string;
  inbox_id?: string;
  from_?: string | string[];
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  preview?: string;
  timestamp?: string;
  created_at?: string;
};

type AgentmailEnvelope = {
  event_type?: string;
  event_id?: string;
  message?: AgentmailMessage;
};
