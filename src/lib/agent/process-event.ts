/**
 * Processor for one `agent_events` row. Called from the Composio webhook
 * (via waitUntil) and from the cron sweep that picks up stuck-pending rows.
 *
 * Flow per event:
 *   1. Atomic claim: flip status pending → processing, stamp claimed_at.
 *      Only the request that wins the claim runs George.
 *   2. Resolve framing: turn the event-type-specific payload into a
 *      "you received this inbound thing; decide what to do" prompt.
 *      Today only OUTLOOK_NEW_MESSAGE is implemented — other types are
 *      marked 'skipped' for forward-compat.
 *   3. Create an agent_sessions row (channel='email') so the user can
 *      review George's take in the existing chat history rail.
 *   4. Seed an agent_messages row with the inbound content so it shows
 *      up at the top of the conversation.
 *   5. Run runGeorgeAutonomous with the framing prompt; persist the
 *      summary as an assistant message and link the SDK session id back
 *      onto agent_sessions so chat resumes work.
 *   6. Update agent_events: status, session_id, error, processed_at.
 */
import { runGeorgeAutonomous } from "./run-autonomous";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callAction } from "@/lib/composio/client";

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

export type ProcessEventResult =
  | { skipped: true; reason: "not_found" | "already_claimed" | "unsupported_type" }
  | {
      skipped: false;
      sessionId: string | null;
      status: "processed" | "failed";
      error: string | null;
    };

const PROCESS_TIME_BUDGET_MS = 240_000;

export async function processAgentEvent(
  eventId: string,
): Promise<ProcessEventResult> {
  const admin = createSupabaseAdmin();

  // 1) Atomic claim. Flip status pending → processing only once.
  const claim = await admin
    .from("agent_events")
    .update({ status: "processing", claimed_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "pending")
    .select("id, org_id, source, source_event_id, event_type, payload, status, session_id")
    .maybeSingle();

  if (claim.error) {
    return { skipped: false, sessionId: null, status: "failed", error: claim.error.message };
  }
  if (!claim.data) {
    // Either the row doesn't exist or someone else already claimed it.
    const probe = await admin
      .from("agent_events")
      .select("id")
      .eq("id", eventId)
      .maybeSingle();
    return {
      skipped: true,
      reason: probe.data ? "already_claimed" : "not_found",
    };
  }
  const event = claim.data as EventRow;

  // 2a) Agentmail branch — inbound email lands in /inbox only. No autonomous
  //     George run for this slice; that's wired up later. We have the full
  //     body in the webhook payload, so no fetch step is needed.
  if (event.source === "agentmail") {
    return await processAgentmailEvent(event, admin);
  }

  // 2b) Resolve framing for Composio-sourced events. Outlook "new mail" triggers
  //    today; everything else gets marked 'skipped' so we don't leave rows hanging.
  //    OUTLOOK_MESSAGE_TRIGGER is the current Composio slug; OUTLOOK_NEW_MESSAGE
  //    is kept as a legacy alias.
  const OUTLOOK_NEW_MAIL_SLUGS = new Set([
    "OUTLOOK_MESSAGE_TRIGGER",
    "OUTLOOK_NEW_MESSAGE",
  ]);
  if (!OUTLOOK_NEW_MAIL_SLUGS.has(event.event_type)) {
    await admin
      .from("agent_events")
      .update({
        status: "skipped",
        error: `unsupported event_type: ${event.event_type}`,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return { skipped: true, reason: "unsupported_type" };
  }

  // Composio's OUTLOOK_MESSAGE_TRIGGER notifies us with just { event_type, id }
  // — the actual mail body/sender/subject must be fetched separately via the
  // Graph API. We do that here using the same connected account.
  const triggerData =
    ((event.payload as Record<string, unknown> | null)?.data as
      | Record<string, unknown>
      | undefined) ?? {};
  const messageId = (triggerData.id as string | undefined) ?? null;
  let fetchedMessage: Record<string, unknown> | null = null;
  if (messageId) {
    const fetched = await callAction<Record<string, unknown>>(
      "OUTLOOK_GET_MESSAGE",
      event.org_id,
      { messageId },
    );
    if (fetched.ok) {
      fetchedMessage = fetched.data;
    } else {
      console.warn("[process-event] OUTLOOK_GET_MESSAGE failed", {
        messageId,
        error: fetched.error,
      });
    }
  }
  // Pass both the original envelope (for fallback paths) and the fetched
  // full message. The parser tries the fetched one first.
  const email = extractOutlookMessage(
    fetchedMessage ? { ...event.payload, fetched: fetchedMessage } : event.payload,
  );
  const framing = buildOutlookFramingPrompt(email);
  const sessionTitle = `Email: ${email.subject ?? "(no subject)"}`.slice(0, 120);
  const seedContent = renderInboundForChat(email);

  // 3) Create the agent_sessions row up front so a session_id exists even
  //    if the agent run errors. The chat history rail will then show the
  //    inbound email + the failure so the user can react.
  const sessionInsert = await admin
    .from("agent_sessions")
    .insert({
      org_id: event.org_id,
      user_id: null,
      channel: "email",
      title: sessionTitle,
    })
    .select("id")
    .single();

  if (sessionInsert.error || !sessionInsert.data) {
    const errMsg =
      sessionInsert.error?.message ?? "could not create agent_sessions row";
    await admin
      .from("agent_events")
      .update({
        status: "failed",
        error: errMsg,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return {
      skipped: false,
      sessionId: null,
      status: "failed",
      error: errMsg,
    };
  }
  const sessionId = sessionInsert.data.id as string;

  // 4) Seed the conversation with the inbound email so the reviewer sees it
  //    at the top of the chat. role='user' is the simplest framing — the
  //    chat history rail already renders user messages.
  await admin.from("agent_messages").insert({
    session_id: sessionId,
    role: "user",
    content: seedContent,
  });

  // 5) Run George autonomously. The runner enforces no send_email_draft, no
  //    AskUserQuestion, structured summary.
  const result = await runGeorgeAutonomous({
    orgId: event.org_id,
    userPrompt: framing,
    timeBudgetMs: PROCESS_TIME_BUDGET_MS,
    clientAppTag: "agent-george-event/0.1",
  });

  // Persist George's summary as an assistant message so the reviewer can
  // read it in the chat UI.
  if (result.summary) {
    await admin.from("agent_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: result.summary,
    });
  }

  // Link SDK session id so when the reviewer types in this session George
  // resumes with full context (and can then call send_email_draft, which
  // is allowed in chat mode).
  if (result.sdkSessionId) {
    await admin
      .from("agent_sessions")
      .update({ sdk_session_id: result.sdkSessionId })
      .eq("id", sessionId);
  }

  // 6) Mark the event done.
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

  return {
    skipped: false,
    sessionId,
    status: finalStatus,
    error: result.error,
  };
}

type OutlookMessageFields = {
  message_id: string | null;
  conversation_id: string | null;
  subject: string | null;
  from: { name: string | null; address: string | null } | null;
  to: string[];
  body_text: string | null;
  body_preview: string | null;
  received_at: string | null;
};

/**
 * Best-effort extraction of email fields from Composio's webhook envelope.
 * Composio wraps the actual provider payload differently depending on the
 * trigger and version, so we probe a few common paths. Fields we can't find
 * come back null — the framing prompt tolerates missing data.
 *
 * If real deliveries don't match these paths, fix here once and re-run; the
 * full envelope is preserved in `agent_events.payload` for diagnosis.
 */
export function extractOutlookMessage(
  payload: Record<string, unknown> | null | undefined,
): OutlookMessageFields {
  const p = (payload ?? {}) as Record<string, unknown>;

  // Try a few common envelope shapes:
  //   { type, data: { …graph message… } }
  //   { type, payload: { data: { …graph message… } } }
  //   { …graph message… } flat
  const candidates: Array<Record<string, unknown>> = [];
  const push = (v: unknown) => {
    if (v && typeof v === "object") candidates.push(v as Record<string, unknown>);
  };
  // Prefer the explicitly-fetched full message (Composio OUTLOOK_GET_MESSAGE
  // returns a Microsoft Graph message object under `data` per callAction).
  const fetched = p.fetched as Record<string, unknown> | undefined;
  if (fetched) {
    push(fetched);
    push(fetched.data);
    push(fetched.response_data);
  }
  push(p);
  push(p.data);
  const inner = p.payload as Record<string, unknown> | undefined;
  if (inner) {
    push(inner);
    push(inner.data);
  }

  const pick = <T,>(...paths: Array<(o: Record<string, unknown>) => T | null | undefined>): T | null => {
    for (const c of candidates) {
      for (const path of paths) {
        try {
          const v = path(c);
          if (v != null) return v;
        } catch {
          // ignore
        }
      }
    }
    return null;
  };

  const message_id = pick<string>(
    (o) => o.id as string,
    (o) => o.messageId as string,
    (o) => (o.message as Record<string, unknown> | undefined)?.id as string,
  );
  const conversation_id = pick<string>(
    (o) => o.conversationId as string,
    (o) => o.conversation_id as string,
    (o) => (o.message as Record<string, unknown> | undefined)?.conversationId as string,
  );
  const subject = pick<string>((o) => o.subject as string);
  const body_preview = pick<string>(
    (o) => o.bodyPreview as string,
    (o) => o.body_preview as string,
  );

  // body can be a string OR a Graph-style { content, contentType }
  const body_text = pick<string>(
    (o) => {
      const b = o.body;
      if (typeof b === "string") return b;
      if (b && typeof b === "object") {
        return (b as { content?: string }).content ?? null;
      }
      return null;
    },
    (o) => o.bodyText as string,
  );

  // from can be a string, { name, address }, or { emailAddress: { name, address } }
  const from = pick<{ name: string | null; address: string | null }>(
    (o) => {
      const f = o.from;
      if (typeof f === "string") return { name: null, address: f };
      if (f && typeof f === "object") {
        const obj = f as Record<string, unknown>;
        const ea = obj.emailAddress as Record<string, unknown> | undefined;
        return {
          name:
            ((ea?.name as string) ?? (obj.name as string) ?? null) || null,
          address:
            ((ea?.address as string) ?? (obj.address as string) ?? null) ||
            null,
        };
      }
      return null;
    },
    (o) => {
      const sender = o.sender as Record<string, unknown> | undefined;
      if (!sender) return null;
      const ea = sender.emailAddress as Record<string, unknown> | undefined;
      return {
        name: ((ea?.name as string) ?? null) || null,
        address: ((ea?.address as string) ?? null) || null,
      };
    },
  );

  // to recipients — collect addresses
  const toRecipients = pick<string[]>((o) => {
    const r = o.toRecipients ?? o.to;
    if (!Array.isArray(r)) return null;
    return r
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const obj = x as Record<string, unknown>;
          const ea = obj.emailAddress as Record<string, unknown> | undefined;
          return (
            ((ea?.address as string) ?? (obj.address as string) ?? null) || null
          );
        }
        return null;
      })
      .filter((s): s is string => !!s);
  });

  const received_at = pick<string>(
    (o) => o.receivedDateTime as string,
    (o) => o.received_at as string,
  );

  return {
    message_id,
    conversation_id,
    subject,
    from,
    to: toRecipients ?? [],
    body_text,
    body_preview,
    received_at,
  };
}

function buildOutlookFramingPrompt(email: OutlookMessageFields): string {
  const fromLabel = email.from
    ? email.from.name && email.from.address
      ? `${email.from.name} <${email.from.address}>`
      : email.from.address ?? email.from.name ?? "(unknown sender)"
    : "(unknown sender)";

  const lines: string[] = [];
  lines.push(
    "An email just arrived in your inbox. You are running in autonomous mode — there is no human to ask follow-up questions right now. Read the email, decide what to do, and draft a reply if one is appropriate.",
    "",
    "## What to do",
    "1. Identify the customer/contact: call `find_customer` or `find_contact` if you can extract a domain or name. If you can't tie this to anyone you know, note that and stop short of drafting.",
    "2. Decide one of:",
    "   - **Reply** — for anything operationally on-track. Use `draft_email_reply` with the Outlook message id below. DO NOT call `send_email_draft` — humans review every outbound message.",
    "   - **Route to human** — if the email needs a decision a CSM should make. Do not draft; explain why in your summary.",
    "   - **No-op** — auto-newsletters, bounce-backs, calendar invites, obvious noise. State the reason in your summary.",
    "3. Whatever you draft, ground it in the org's playbook — use `read_knowledge_doc` if you need the wording or process.",
    "",
    "## The email",
    "",
    `- From: ${fromLabel}`,
  );
  if (email.to.length) lines.push(`- To: ${email.to.join(", ")}`);
  if (email.subject) lines.push(`- Subject: ${email.subject}`);
  if (email.received_at) lines.push(`- Received at: ${email.received_at}`);
  if (email.message_id) {
    lines.push(`- Outlook message id (use for draft_email_reply): \`${email.message_id}\``);
  }
  if (email.conversation_id) {
    lines.push(`- Conversation id: \`${email.conversation_id}\``);
  }
  lines.push("");
  lines.push("### Body");
  lines.push("");
  lines.push(email.body_text ?? email.body_preview ?? "(no body)");

  return lines.join("\n");
}

function renderInboundForChat(email: OutlookMessageFields): string {
  const fromLabel = email.from
    ? email.from.name && email.from.address
      ? `${email.from.name} <${email.from.address}>`
      : email.from.address ?? email.from.name ?? "(unknown)"
    : "(unknown)";
  const parts: string[] = [];
  parts.push(`**Inbound email** — from ${fromLabel}`);
  if (email.subject) parts.push(`**Subject:** ${email.subject}`);
  parts.push("");
  parts.push(email.body_text ?? email.body_preview ?? "_(no body captured)_");
  return parts.join("\n");
}

// ----- Agentmail handling ----------------------------------------------------
// Agentmail delivers the full message body in the webhook envelope, so we
// don't need a fetch step. For this slice, the user explicitly wants inbox
// visibility only — no autonomous George run. That makes this branch a thin
// "create session + seed inbound message + mark processed" path.

type AgentmailMessagePayload = {
  message_id?: string;
  thread_id?: string;
  from_?: string | string[];
  to?: string[];
  subject?: string;
  text?: string;
  html?: string;
  preview?: string;
  timestamp?: string;
};

function extractAgentmailMessage(
  payload: Record<string, unknown> | null | undefined,
): OutlookMessageFields {
  const msg = ((payload ?? {}) as { message?: AgentmailMessagePayload }).message ?? {};
  const fromRaw = msg.from_;
  const fromAddress = Array.isArray(fromRaw) ? fromRaw[0] : fromRaw ?? null;
  return {
    message_id: msg.message_id ?? null,
    conversation_id: msg.thread_id ?? null,
    subject: msg.subject ?? null,
    from: fromAddress ? { name: null, address: fromAddress } : null,
    to: Array.isArray(msg.to) ? msg.to : [],
    body_text: msg.text ?? null,
    body_preview: msg.preview ?? null,
    received_at: msg.timestamp ?? null,
  };
}

async function processAgentmailEvent(
  event: EventRow,
  admin: ReturnType<typeof createSupabaseAdmin>,
): Promise<ProcessEventResult> {
  const PROCESSABLE = new Set(["message.received"]);
  if (!PROCESSABLE.has(event.event_type)) {
    await admin
      .from("agent_events")
      .update({
        status: "skipped",
        error: `unsupported event_type: ${event.event_type}`,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return { skipped: true, reason: "unsupported_type" };
  }

  const email = extractAgentmailMessage(event.payload);
  const sessionTitle = `Email: ${email.subject ?? "(no subject)"}`.slice(0, 120);
  const seedContent = renderInboundForChat(email);

  const sessionInsert = await admin
    .from("agent_sessions")
    .insert({
      org_id: event.org_id,
      user_id: null,
      channel: "email",
      title: sessionTitle,
    })
    .select("id")
    .single();

  if (sessionInsert.error || !sessionInsert.data) {
    const errMsg =
      sessionInsert.error?.message ?? "could not create agent_sessions row";
    await admin
      .from("agent_events")
      .update({
        status: "failed",
        error: errMsg,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return { skipped: false, sessionId: null, status: "failed", error: errMsg };
  }
  const sessionId = sessionInsert.data.id as string;

  await admin.from("agent_messages").insert({
    session_id: sessionId,
    role: "user",
    content: seedContent,
  });

  await admin
    .from("agent_events")
    .update({
      status: "processed",
      session_id: sessionId,
      processed_at: new Date().toISOString(),
    })
    .eq("id", event.id);

  return { skipped: false, sessionId, status: "processed", error: null };
}
