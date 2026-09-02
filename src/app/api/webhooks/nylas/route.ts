import { NextRequest } from "next/server";
import { after } from "next/server";
import crypto from "node:crypto";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { processAgentEvent } from "@/lib/agent/process-event";
import { isSenderAllowed } from "@/lib/agent/sender-allowlist";
import { resolveInboundOrg } from "@/lib/agent/inbound-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nylas webhook landing pad — inbound mail for George's own mailbox.
 *
 * This is the counterpart to the Composio/Outlook webhook. Same shape of work,
 * because the downstream machinery (agent_events -> processAgentEvent -> the cron
 * sweep backstop) is provider-agnostic:
 *
 *   1. Answer Nylas' GET challenge, which it uses to validate the endpoint
 *      before it will register or deliver to it.
 *   2. Verify the HMAC signature on every POST.
 *   3. Ignore George's own outbound mail, or it would react to itself.
 *   4. Apply the inbound sender allowlist, so the inbox stays signal-only.
 *   5. Persist an `agent_events` row (status 'pending'), deduped on the Nylas
 *      delivery id — a retry lands as a no-op.
 *   6. Return 200 fast, then `after(...)` runs the agent, so Nylas never sees
 *      our wall time and retry-bombs us.
 *
 * A restart mid-`after()` drops the work, which is exactly what the cron sweep
 * exists to pick up — the same guarantee the Composio path relies on.
 */

/** Nylas validates a new endpoint by GETting it with ?challenge=… */
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("challenge");
  if (!challenge) return new Response("missing challenge", { status: 400 });
  // Must be echoed back as plain text, nothing else.
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifyNylasSignature(req, raw)) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: NylasWebhookEnvelope;
  try {
    body = JSON.parse(raw) as NylasWebhookEnvelope;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Envelope: { id, type: "message.created", data: { object: {...message} },
  //             webhook_delivery_attempt, time }
  const type = body.type ?? "";
  const message = body.data?.object ?? {};
  const deliveryId = body.id ?? null;

  const admin = createSupabaseAdmin();

  // We only care about mail arriving. message.updated fires for read-state and
  // folder changes too, which would re-trigger the agent on its own bookkeeping.
  if (type !== "message.created") {
    await admin.from("audit_log").insert({
      org_id: null,
      actor: "nylas",
      action: "webhook.ignored",
      payload: { type, delivery_id: deliveryId, reason: "unhandled_type" },
    });
    return new Response("ok (ignored)", { status: 200 });
  }

  const fromAddress = message.from?.[0]?.email ?? null;
  const selfAddress = process.env.NYLAS_FROM_EMAIL?.trim().toLowerCase() ?? null;

  // George's own sends arrive here too. Reacting to them would put the agent in
  // a loop with itself.
  if (fromAddress && selfAddress && fromAddress.toLowerCase() === selfAddress) {
    return new Response("ok (own message)", { status: 200 });
  }

  // The grant tells us which mailbox — and therefore which org — this belongs
  // to. Today George has one mailbox, so the org comes from configuration; when
  // mailboxes become per-org this is the seam where that lookup goes.
  const grantId = body.data?.grant_id ?? message.grant_id ?? null;
  const expectedGrant = process.env.NYLAS_GRANT_ID?.trim() ?? null;
  if (expectedGrant && grantId && grantId !== expectedGrant) {
    // Not our mailbox. Acknowledge so Nylas stops retrying, but do nothing.
    return new Response("ok (unknown grant)", { status: 200 });
  }
  // Resolved from the message, not from configuration.
  //
  // This was process.env.GEORGE_ORG_ID: one configured org for every
  // inbound message, on a mailbox serving several. A reply to a touchpoint
  // in any other tenant was filed under the wrong company, matched no
  // thread, and did nothing — silently, because a message attributed to the
  // wrong org looks exactly like a message about nothing.
  const attribution = await resolveInboundOrg(admin, {
    threadId: message.thread_id ?? null,
    fromAddress,
  });
  const orgId = attribution.orgId;
  if (!orgId) {
    // Acknowledged so Nylas stops retrying, and audited so it is findable:
    // an unattributable message must not become a message nobody knows
    // arrived. Guessing a tenant is the one thing worse than dropping it.
    console.error("[nylas webhook] cannot attribute inbound mail to an org", {
      thread_id: message.thread_id ?? null,
      from: fromAddress,
      detail: attribution.detail,
    });
    await admin.from("audit_log").insert({
      org_id: null,
      actor: "nylas",
      action: "email.unattributed",
      payload: {
        delivery_id: deliveryId,
        message_id: message.id ?? null,
        thread_id: message.thread_id ?? null,
        from: fromAddress,
        reason: attribution.detail,
      },
    });
    return new Response("ok (unattributable)", { status: 200 });
  }
  if (attribution.guessed) {
    console.warn("[nylas webhook] org attributed by fallback, not by evidence", {
      org_id: orgId,
      from: fromAddress,
      detail: attribution.detail,
    });
  }

  // Signal-only inbox: the same allowlist the Outlook path uses. Unknown senders
  // are acknowledged (so delivery stops) and audited (so the allowlist can be
  // widened later), but they create no work.
  const decision = await isSenderAllowed(orgId, fromAddress);
  await admin.from("audit_log").insert({
    org_id: orgId,
    actor: "nylas",
    action: decision.allowed ? "email.received" : "email.rejected",
    payload: {
      delivery_id: deliveryId,
      message_id: message.id ?? null,
      thread_id: message.thread_id ?? null,
      from: fromAddress,
      subject: message.subject ?? null,
      reason: decision.reason,
      org_source: attribution.source,
      org_guessed: attribution.guessed,
    },
  });
  if (!decision.allowed) {
    return new Response("ok (sender not allowlisted)", { status: 200 });
  }

  const insert = await admin
    .from("agent_events")
    .insert({
      org_id: orgId,
      source: "nylas",
      source_event_id: deliveryId,
      event_type: "NYLAS_NEW_MESSAGE",
      payload: body as unknown as Record<string, unknown>,
      status: "pending",
    })
    .select("id")
    .single();

  if (insert.error) {
    // 23505 = unique violation = a retry of a delivery already accepted.
    if (insert.error.code === "23505") {
      return new Response("ok (duplicate)", { status: 200 });
    }
    console.error("[nylas webhook] failed to persist event", insert.error);
    return new Response("persist failed", { status: 500 });
  }

  const eventId = insert.data.id as string;

  // Respond first, work after: Nylas retries on slow responses, and an agent run
  // takes far longer than any webhook timeout.
  after(async () => {
    try {
      await processAgentEvent(eventId);
    } catch (err) {
      console.error("[nylas webhook] processAgentEvent failed", eventId, err);
    }
  });

  return new Response("ok", { status: 200 });
}

/**
 * Verify the HMAC-SHA256 signature Nylas sends on every delivery.
 *
 * Unset secret is refused in production rather than accepted with a warning.
 * The Composio path chose accept-with-warn for dev convenience and the result is
 * visible on staging right now: NODE_ENV is "production" there, the secret is
 * empty, and every inbound webhook is being rejected — a broken integration that
 * looks like a broken provider. Failing loudly here at least says why.
 */
function verifyNylasSignature(req: NextRequest, raw: string): boolean {
  const secret = process.env.NYLAS_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[nylas webhook] NYLAS_WEBHOOK_SECRET unset in production — rejecting.");
      return false;
    }
    console.warn("[nylas webhook] NYLAS_WEBHOOK_SECRET unset — accepting without verification (dev only).");
    return true;
  }

  const provided = req.headers.get("x-nylas-signature") ?? "";
  if (!provided) return false;

  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.trim().toLowerCase(), "utf8");
  // Constant-time compare, and length-checked first because timingSafeEqual
  // throws on a length mismatch rather than returning false.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type NylasWebhookEnvelope = {
  id?: string;
  type?: string;
  time?: number;
  data?: {
    grant_id?: string;
    object?: {
      id?: string;
      grant_id?: string;
      thread_id?: string;
      subject?: string;
      snippet?: string;
      from?: Array<{ email?: string; name?: string }>;
      to?: Array<{ email?: string; name?: string }>;
      date?: number;
    };
  };
};
