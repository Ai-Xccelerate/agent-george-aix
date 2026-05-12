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

  // Composio v3 envelope:
  //   { id, timestamp, type: "composio.trigger.message",
  //     metadata: { user_id, trigger_name, connected_account_id, ... },
  //     data: { event_type, ...toolkit-specific payload... } }
  // Tolerate older shapes too.
  const data = (body.data as Record<string, unknown> | undefined) ?? {};
  const metadata =
    (body.metadata as Record<string, unknown> | undefined) ?? {};
  const userId =
    (metadata.user_id as string | undefined) ??
    (metadata.userId as string | undefined) ??
    (body.userId as string | undefined) ??
    (body.user_id as string | undefined) ??
    (data.user_id as string | undefined) ??
    (data.userId as string | undefined) ??
    (body.payload?.userId as string | undefined) ??
    null;
  const orgId = parseOrgIdFromUser(userId);
  // Trigger slug we route on (e.g. OUTLOOK_MESSAGE_TRIGGER). The envelope
  // `type` is the delivery wrapper (composio.trigger.message), not what we
  // dispatch on.
  const triggerSlug =
    (metadata.trigger_name as string | undefined) ??
    (metadata.triggerName as string | undefined) ??
    (metadata.trigger_slug as string | undefined) ??
    (data.trigger_name as string | undefined) ??
    (data.triggerName as string | undefined) ??
    (body.payload?.type as string | undefined) ??
    null;
  const envelopeType = (body.type as string | undefined) ?? "unknown";
  const eventType = triggerSlug ?? envelopeType;
  const deliveryId =
    (body.id as string | undefined) ??
    (body.delivery_id as string | undefined) ??
    (body.event_id as string | undefined) ??
    (data.id as string | undefined) ??
    (data.delivery_id as string | undefined) ??
    (metadata.id as string | undefined) ??
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
    // Log the envelope shape so we can see what to extract — top-level keys
    // and the data sub-object's keys are usually enough to spot the path.
    const previewScalars = (obj: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [
          k,
          typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? v
            : `<${typeof v}>`,
        ]),
      );
    console.warn("[composio webhook] could not derive orgId", {
      userId,
      envelopeType,
      triggerSlug,
      topLevelKeys: Object.keys(body ?? {}),
      dataKeys: Object.keys(data ?? {}),
      dataPreview: previewScalars(data ?? {}),
      metadataKeys: Object.keys(metadata ?? {}),
      metadataPreview: previewScalars(metadata ?? {}),
    });
    return new Response("ok", { status: 200 });
  }

  // Triggers we actually process today. Anything else lands in audit_log
  // for inspection but doesn't create an event row.
  const PROCESSABLE = new Set([
    "OUTLOOK_MESSAGE_TRIGGER", // current slug for "new Outlook message"
    "OUTLOOK_NEW_MESSAGE",     // legacy alias, harmless to keep
  ]);
  if (!PROCESSABLE.has(eventType)) {
    console.log("[composio webhook] non-processable event", { eventType });
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
  metadata?: unknown;
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

  // Collect every header that could carry a signature or signing context.
  // Composio's exact scheme drifts between versions, and standard-webhooks
  // (Svix) is also common — we try multiple shapes and log everything on
  // failure so a single rejected delivery tells us exactly what to support.
  const headerNames = [
    "x-composio-signature",
    "composio-signature",
    "x-signature",
    "webhook-signature",
    "webhook-id",
    "webhook-timestamp",
  ];
  const headers: Record<string, string> = {};
  for (const name of headerNames) {
    const v = req.headers.get(name);
    if (v) headers[name] = v;
  }

  // Compute candidate HMACs against several payload representations.
  const bodyOnly = raw;
  const webhookId = headers["webhook-id"];
  const webhookTs = headers["webhook-timestamp"];
  const svixPayload =
    webhookId && webhookTs ? `${webhookId}.${webhookTs}.${raw}` : null;

  function hmacAll(payload: string) {
    const h = crypto.createHmac("sha256", secret!).update(payload);
    return { hex: h.digest("hex"), b64: crypto.createHmac("sha256", secret!).update(payload).digest("base64") };
  }
  const expectBody = hmacAll(bodyOnly);
  const expectSvix = svixPayload ? hmacAll(svixPayload) : null;

  // Pull out every signature value (some headers carry multiple comma-separated v1,<sig>).
  const sigStrings: string[] = [];
  for (const name of [
    "x-composio-signature",
    "composio-signature",
    "x-signature",
    "webhook-signature",
  ]) {
    const v = headers[name];
    if (!v) continue;
    for (const part of v.split(/[\s,]+/)) {
      const cleaned = part.replace(/^(sha256=|v1=|v1,)/i, "").trim();
      if (cleaned) sigStrings.push(cleaned);
    }
  }

  function safeEqual(a: string, b: string) {
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  const candidates: Array<{ scheme: string; expected: string }> = [
    { scheme: "body/hex", expected: expectBody.hex },
    { scheme: "body/base64", expected: expectBody.b64 },
  ];
  if (expectSvix) {
    candidates.push({ scheme: "svix/hex", expected: expectSvix.hex });
    candidates.push({ scheme: "svix/base64", expected: expectSvix.b64 });
  }

  for (const sig of sigStrings) {
    for (const c of candidates) {
      if (safeEqual(sig, c.expected)) {
        console.log(`[composio webhook] signature OK via ${c.scheme}`);
        return true;
      }
    }
  }

  // Failure — emit a single diagnostic line we can grep in Vercel logs.
  console.error(
    "[composio webhook] signature rejected",
    JSON.stringify({
      receivedHeaders: headers,
      sigsTried: sigStrings.length,
      expectedSchemes: candidates.map((c) => c.scheme),
      bodyBytes: raw.length,
    }),
  );
  return false;
}
