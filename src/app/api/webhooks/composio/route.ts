import { NextRequest } from "next/server";
import { after } from "next/server";
import crypto from "node:crypto";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { processAgentEvent } from "@/lib/agent/process-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Stay well under Vercel's 300s ceiling — the agent run is wall-budgeted
// to 240s inside processAgentEvent, this is just defense in depth for the
// after() handler that picks up where the response left off.
export const maxDuration = 300;

/**
 * Composio webhook landing pad. Fires for triggers like OUTLOOK_NEW_MESSAGE,
 * FIREFLIES_TRANSCRIPT_READY, etc.
 *
 * Flow:
 *   1. Verify HMAC signature (or accept-with-warn when secret is unset, dev
 *      only — see backlog #4 for the prod hardening).
 *   2. Resolve the org from the `userId=org-<uuid>` convention we set on
 *      every Composio connection.
 *   3. Persist an `agent_events` row (status='pending'). Dedupe via the
 *      Composio delivery id falls out of a unique index — retries land as
 *      a no-op insert.
 *   4. Always log to `audit_log` so even unsupported event types are
 *      visible. (Backwards-compat with the old observation-only behavior.)
 *   5. Return 200 fast, then `after(...)` processes the event so Composio
 *      doesn't see our agent's wall time and retry-bomb us. The cron sweep
 *      picks up any rows that stay 'pending' (e.g. cold function killed
 *      the after-handler).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifyComposioSignature(req, raw)) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: ComposioWebhookEnvelope;
  try {
    body = JSON.parse(raw) as ComposioWebhookEnvelope;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const userId = body.userId ?? body.user_id ?? body.payload?.userId ?? null;
  const orgId = parseOrgIdFromUser(userId);
  const eventType = (body.type ?? body.payload?.type ?? "unknown") as string;
  const deliveryId =
    (body.id as string | undefined) ??
    (body.delivery_id as string | undefined) ??
    (body.event_id as string | undefined) ??
    (body.payload?.id as string | undefined) ??
    null;

  // Always log — gives us a paper trail even when we can't process.
  const admin = createSupabaseAdmin();
  if (orgId) {
    await admin.from("audit_log").insert({
      org_id: orgId,
      actor: "composio",
      action: `webhook.${eventType}`,
      payload: {
        type: eventType,
        toolkit: body.toolkit ?? body.payload?.toolkit,
        delivery_id: deliveryId,
        raw: body.payload ?? body.data ?? body,
      },
    });
  } else {
    console.warn("[composio webhook] could not derive orgId", {
      userId,
      type: eventType,
    });
    return new Response("ok", { status: 200 });
  }

  // Triggers we actually process today. Anything else lands in audit_log
  // for inspection but doesn't create an event row.
  const PROCESSABLE = new Set(["OUTLOOK_NEW_MESSAGE"]);
  if (!PROCESSABLE.has(eventType)) {
    return new Response("ok", { status: 200 });
  }

  // Persist the event. Unique index on (org_id, source, source_event_id)
  // makes retries idempotent — the second insert errors with code 23505
  // which we treat as "already seen, skip."
  const insert = await admin
    .from("agent_events")
    .insert({
      org_id: orgId,
      source: "composio",
      source_event_id: deliveryId,
      event_type: eventType,
      payload: body as unknown as Record<string, unknown>,
      status: "pending",
    })
    .select("id")
    .single();

  if (insert.error) {
    // 23505 = unique violation = retry of a delivery we already accepted.
    if (insert.error.code === "23505") {
      return new Response("ok (duplicate)", { status: 200 });
    }
    console.error("[composio webhook] failed to persist event", insert.error);
    return new Response("ok", { status: 200 });
  }

  const eventId = insert.data.id as string;

  // Hand off to the agent runner without blocking the response. If the
  // function dies before after() runs, the cron sweep picks the row up.
  after(async () => {
    try {
      await processAgentEvent(eventId);
    } catch (err) {
      console.error("[composio webhook] processAgentEvent threw", {
        eventId,
        err,
      });
    }
  });

  return new Response("ok", { status: 200 });
}

type ComposioWebhookEnvelope = {
  type?: string;
  toolkit?: string;
  userId?: string;
  user_id?: string;
  id?: string;
  delivery_id?: string;
  event_id?: string;
  data?: unknown;
  payload?: {
    userId?: string;
    toolkit?: string;
    type?: string;
    id?: string;
    [k: string]: unknown;
  };
};

function parseOrgIdFromUser(userId: string | null): string | null {
  if (!userId) return null;
  const m = userId.match(/^org-([0-9a-f-]{36})$/i);
  return m?.[1] ?? null;
}

/**
 * Composio signs webhook payloads with HMAC-SHA256 of the raw body using
 * a per-trigger secret. The exact header name / scheme can drift between
 * Composio versions, so we tolerate a couple of common ones.
 *
 * Production must set COMPOSIO_WEBHOOK_SECRET — backlog #4 hardens this
 * by hard-failing when NODE_ENV='production' and the secret is unset.
 */
function verifyComposioSignature(req: NextRequest, raw: string): boolean {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[composio webhook] COMPOSIO_WEBHOOK_SECRET unset in production — rejecting.",
      );
      return false;
    }
    console.warn(
      "[composio webhook] COMPOSIO_WEBHOOK_SECRET unset — accepting without verification (dev only).",
    );
    return true;
  }

  const candidates = [
    req.headers.get("x-composio-signature"),
    req.headers.get("composio-signature"),
    req.headers.get("x-signature"),
  ].filter(Boolean) as string[];

  if (candidates.length === 0) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex");

  return candidates.some((s) => {
    const cleaned = s.replace(/^sha256=/, "").trim();
    if (cleaned.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(cleaned, "hex"),
        Buffer.from(expected, "hex"),
      );
    } catch {
      return false;
    }
  });
}
