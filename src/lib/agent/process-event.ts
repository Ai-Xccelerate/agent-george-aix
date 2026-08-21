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
import { isSenderAllowed } from "./sender-allowlist";
import { isInternalDomain } from "./identity";
import { createNylasClient, nylasConfig } from "@/lib/nylas/client";

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

  // NOTE: staleness is enforced where work is CREATED, not here. An event's own
  // age tells you nothing — a backfill mints fresh events for years-old meetings.
  // See the enqueue window in transcript-sync.ts and mailbox-sync.ts.

  // Transcript-ready events have their own flow (no Outlook fetch / allowlist).
  if (event.event_type === "TRANSCRIPT_READY") {
    return await handleTranscriptReady(admin, event);
  }

  // Resolve framing for Composio-sourced events. Outlook "new mail" triggers
  //    today; everything else gets marked 'skipped' so we don't leave rows hanging.
  //    OUTLOOK_MESSAGE_TRIGGER is the current Composio slug; OUTLOOK_NEW_MESSAGE
  //    is kept as a legacy alias.
  // Inbound-mail events, whichever transport delivered them. NYLAS_NEW_MESSAGE
  // comes from George's own mailbox (webhook or the mirror backstop); the
  // OUTLOOK_* slugs are Composio's. Everything downstream of extraction is
  // provider-agnostic, so both converge on the same agent run.
  const NEW_MAIL_SLUGS = new Set([
    "OUTLOOK_MESSAGE_TRIGGER",
    "OUTLOOK_NEW_MESSAGE",
    "NYLAS_NEW_MESSAGE",
  ]);
  if (!NEW_MAIL_SLUGS.has(event.event_type)) {
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
      // Persist the fetched Graph message onto the event row so the
      // /inbox/[id] detail page can render subject/from/body. Webhook
      // only stored the trigger envelope ({event_type, id, ...}), which
      // has no body. Merge under `fetched` to match extractOutlookMessage.
      await admin
        .from("agent_events")
        .update({
          payload: { ...event.payload, fetched: fetchedMessage },
        })
        .eq("id", event.id);
    } else {
      console.warn("[process-event] OUTLOOK_GET_MESSAGE failed", {
        messageId,
        error: fetched.error,
      });
    }
  }
  // Pass both the original envelope (for fallback paths) and the fetched
  // full message. The parser tries the fetched one first.
  // George's own mailbox: fetch and normalise through Nylas instead of Graph.
  // extractNylasMessage returns the identical shape, so the framing prompt,
  // the allowlist gate and the session seeding below are untouched.
  const isNylasEvent = event.event_type === "NYLAS_NEW_MESSAGE";
  const email = isNylasEvent
    ? await extractNylasMessage(event.payload)
    : extractOutlookMessage(
        fetchedMessage ? { ...event.payload, fetched: fetchedMessage } : event.payload,
      );

  // Sender allowlist gate. Drop firehose/spam without creating a session.
  const senderDecision = await isSenderAllowed(event.org_id, email.from?.address ?? null);
  if (!senderDecision.allowed) {
    await admin
      .from("agent_events")
      .update({
        status: "skipped",
        error: `allowlist: ${senderDecision.reason}`,
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return { skipped: true, reason: "unsupported_type" };
  }

  const manager = await getManagerContact(admin, event.org_id);
  const framing = buildOutlookFramingPrompt(email, manager);
  const sessionTitle = `Email: ${email.subject ?? "(no subject)"}`.slice(0, 120);
  const seedContent = renderInboundForChat(email);

  // Resolve sender → customer so the inbox/actions list can label the row.
  // Match contacts.email first (most specific), then customers.domain on the
  // sender's domain. No match → null and we keep going.
  const customerId = await resolveSenderToCustomer(
    event.org_id,
    email.from?.address ?? null,
  );

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
      customer_id: customerId,
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
  const seedInsert = await admin.from("agent_messages").insert({
    session_id: sessionId,
    role: "user",
    content: seedContent,
  });
  if (seedInsert.error) {
    console.error("[process-event] seed message insert failed", { sessionId, error: seedInsert.error.message });
  }

  // 5) Run George autonomously. The runner enforces no send_email_draft, no
  //    AskUserQuestion, structured summary.
  const result = await runGeorgeAutonomous({
    orgId: event.org_id,
    userPrompt: framing,
    timeBudgetMs: PROCESS_TIME_BUDGET_MS,
    clientAppTag: "agent-george-event/0.1",
    sessionId,
    // George may send to internal (@aixccelerate.com) recipients — reply to an
    // internal thread, escalate to his manager — but the send tool refuses
    // any draft with an external recipient.
    emailSendPolicy: "internal_only",
  });

  // Persist George's summary as an assistant message so the reviewer can
  // read it in the chat UI.
  if (result.summary) {
    const summaryInsert = await admin.from("agent_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: result.summary,
    });
    if (summaryInsert.error) {
      console.error("[process-event] summary message insert failed", { sessionId, error: summaryInsert.error.message });
    }
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

  // Stamp the mirrored email so the mailbox shows a "George reviewed" badge
  // linking to his write-up.
  if (finalStatus === "processed" && email.message_id) {
    await admin
      .from("email_messages")
      .update({ processed_at: new Date().toISOString(), processed_session_id: sessionId })
      .eq("org_id", event.org_id)
      .eq("external_id", email.message_id);
  }

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
/**
 * Normalise a Nylas inbound message into the same shape as the Graph path.
 *
 * Two envelope shapes reach here:
 *   webhook  { type, data: { object: { …message… } } }
 *   mirror   { data: { id }, source: "mailbox_sync" }  — id only
 *
 * The mirror form carries no body, so the message is fetched from Nylas. That
 * fetch is best-effort: a failure degrades to whatever the envelope held rather
 * than aborting the run, matching how the Graph path tolerates a failed
 * OUTLOOK_GET_MESSAGE.
 */
export async function extractNylasMessage(
  payload: Record<string, unknown> | null | undefined,
): Promise<OutlookMessageFields> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const data = (p.data ?? {}) as Record<string, unknown>;
  let m = ((data.object ?? data) ?? {}) as Record<string, unknown>;

  const id = (m.id as string) ?? null;
  // Body absent (mirror backstop, or a webhook that only sent metadata) —
  // fetch the full message so the agent has something to reason about.
  if (id && !m.body && !m.snippet) {
    const cfg = nylasConfig();
    if (cfg) {
      const full = await createNylasClient(cfg).getMessage(id);
      if (full.ok) m = full.data as unknown as Record<string, unknown>;
      else console.warn("[process-event] nylas getMessage failed", { id, error: full.error });
    }
  }

  const fromArr = Array.isArray(m.from) ? (m.from as Array<Record<string, unknown>>) : [];
  const first = fromArr[0] ?? null;
  const toArr = Array.isArray(m.to) ? (m.to as Array<Record<string, unknown>>) : [];
  const html = (m.body as string) ?? null;

  return {
    message_id: id,
    conversation_id: (m.thread_id as string) ?? null,
    subject: (m.subject as string) ?? null,
    from: first
      ? { name: (first.name as string) ?? null, address: (first.email as string) ?? null }
      : null,
    to: toArr.map((t) => (t.email as string) ?? "").filter(Boolean),
    // The framing prompt wants prose, not markup.
    body_text: html ? htmlToText(html) : ((m.snippet as string) ?? null),
    body_preview: (m.snippet as string) ?? null,
    received_at:
      typeof m.date === "number" ? new Date(m.date * 1000).toISOString() : null,
  };
}

/** Minimal HTML-to-text for inbound bodies. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

function buildOutlookFramingPrompt(
  email: OutlookMessageFields,
  manager: ManagerContact | null,
): string {
  const fromLabel = email.from
    ? email.from.name && email.from.address
      ? `${email.from.name} <${email.from.address}>`
      : email.from.address ?? email.from.name ?? "(unknown sender)"
    : "(unknown sender)";

  const senderDomain = (email.from?.address?.split("@")[1] ?? "").toLowerCase();
  const senderInternal = isInternalDomain(senderDomain);
  const managerLine = manager?.email
    ? `${manager.name ?? "your manager"} <${manager.email}>`
    : "your manager (no manager email is configured — note this in your summary instead of emailing)";

  const lines: string[] = [];
  lines.push(
    "An email just arrived in your inbox. You are running in autonomous mode — there is no human to ask follow-up questions in real time. Read it, triage it, and act.",
    "",
    "## Step 1 — Identify",
    "Call `find_customer` / `find_contact` to tie the sender to a customer if you can. Check the thread and records for context (`get_customer`, `search_emails`).",
    "",
    "## Step 2 — Triage into exactly one of:",
    "- **Act (in-scope)** — it asks something of you or is clearly part of your job (onboarding, scheduling, a question you can answer from the playbook/records, a follow-up). Do the work.",
    "- **FYI only** — you're cc'd, or it's informational with no ask of you, or it's noise (newsletters, bounces, auto-replies, calendar invites). Take NO action; just record a one-line FYI in your summary.",
    "- **Escalate** — it needs a human judgement call (pricing, commitments, contract/legal, anything you're unsure about, or any reply that must go to an EXTERNAL recipient). See Step 3.",
    "",
    "## Step 3 — How to respond (trust boundary = recipient domain)",
    `- The sender here is **${senderInternal ? "INTERNAL (@aixccelerate.com)" : "EXTERNAL"}**.`,
    "- **Internal recipients (@aixccelerate.com):** you MAY draft AND send (`draft_email_reply` → `send_email_draft`). Replies to an internal teammate and notes to your manager are fine to send.",
    "- **External recipients (customers/partners):** `draft_email_reply` ONLY — do NOT send. Leave the draft for human review and escalate (the send tool will refuse external recipients anyway).",
    `- **When in doubt, escalate:** call \`raise_decision\` (title, detail, your recommendation, and 1–4 concrete \`suggested_actions\` the reviewer can click to hand back to you) to put it on the team's Needs-you queue, then send a one-line internal heads-up to your manager ${managerLine}. Don't guess on anything customer-facing or commercial.`,
    "- Ground every draft in the org's playbook — use `read_knowledge_doc` for wording/process.",
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

export type ManagerContact = { name: string | null; email: string | null };

/** George's escalation contact — the agent's configured human owner. */
export async function getManagerContact(
  admin: ReturnType<typeof createSupabaseAdmin>,
  orgId: string,
): Promise<ManagerContact | null> {
  const settings = await admin
    .from("agent_settings")
    .select("owner_user_id")
    .eq("org_id", orgId)
    .eq("agent_slug", "george")
    .maybeSingle();
  const ownerId = settings.data?.owner_user_id as string | null | undefined;
  if (!ownerId) return null;
  const member = await admin
    .from("org_members")
    .select("full_name, email")
    .eq("org_id", orgId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (!member.data) return null;
  return {
    name: (member.data.full_name as string | null) ?? null,
    email: (member.data.email as string | null) ?? null,
  };
}

/**
 * Transcript-ready flow: a meeting George's note-taker recorded just landed in
 * the mirror. George reads it and updates what the account record says — the
 * onboarding plan, objectives and commitments, blockers, a health signal.
 *
 * TRANSCRIPT EVENTS ARE SILENT BY DESIGN.
 * This run produces nothing outbound: no email, no draft, no notification. That
 * is the intended end state, not an unfinished one — worth saying explicitly,
 * because "does nothing visible" reads exactly like a half-built feature and the
 * obvious next commit is to add a notification.
 *
 * George used to draft a post-meeting recap here. That task came from the CSM
 * role he was first built for; at AI Xccelerate it is redundant, because Scribe
 * already sends recaps to the people who attended. On 2026-08-20 the dormant task
 * woke when a sync bug was fixed, ran ~490 times and mailed 16 unrequested recaps
 * to colleagues. The feature is deleted, not disabled.
 *
 * If a health signal turns red that is a SEPARATE trigger with its own recipient
 * resolution. Do not reach for this handler to send it.
 */
async function handleTranscriptReady(
  admin: ReturnType<typeof createSupabaseAdmin>,
  event: EventRow,
): Promise<ProcessEventResult> {
  const meetingExtId =
    ((event.payload?.data as Record<string, unknown> | undefined)?.id as string) ??
    event.source_event_id ??
    null;
  const { data: t } = await admin
    .from("meeting_transcripts")
    .select("id, title, summary, customer_id, ended_at")
    .eq("org_id", event.org_id)
    .eq("external_id", meetingExtId ?? "")
    .maybeSingle();

  if (!t) {
    await admin
      .from("agent_events")
      .update({
        status: "skipped",
        error: "transcript row not found",
        processed_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    return { skipped: true, reason: "not_found" };
  }
  const transcript = t as {
    id: string;
    title: string | null;
    summary: string | null;
    customer_id: string | null;
    ended_at: string | null;
  };

  const manager = await getManagerContact(admin, event.org_id);
  const framing = buildTranscriptFramingPrompt(transcript, manager);
  const sessionTitle = `Meeting: ${transcript.title ?? "(untitled)"}`.slice(0, 120);

  const sessionInsert = await admin
    .from("agent_sessions")
    .insert({
      org_id: event.org_id,
      user_id: null,
      channel: "cron",
      title: sessionTitle,
      customer_id: transcript.customer_id,
    })
    .select("id")
    .single();
  if (sessionInsert.error || !sessionInsert.data) {
    const errMsg = sessionInsert.error?.message ?? "could not create session";
    await admin
      .from("agent_events")
      .update({ status: "failed", error: errMsg, processed_at: new Date().toISOString() })
      .eq("id", event.id);
    return { skipped: false, sessionId: null, status: "failed", error: errMsg };
  }
  const sessionId = sessionInsert.data.id as string;

  const transcriptSeedInsert = await admin.from("agent_messages").insert({
    session_id: sessionId,
    role: "user",
    content: `**Meeting transcript ready** — ${transcript.title ?? "(untitled)"}${
      transcript.summary ? `\n\n${transcript.summary}` : ""
    }`,
  });
  if (transcriptSeedInsert.error) {
    console.error("[process-event] transcript seed message insert failed", { sessionId, error: transcriptSeedInsert.error.message });
  }

  const result = await runGeorgeAutonomous({
    orgId: event.org_id,
    userPrompt: framing,
    timeBudgetMs: PROCESS_TIME_BUDGET_MS,
    clientAppTag: "agent-george-transcript/0.1",
    sessionId,
    // Nothing leaves this run. "none" makes runGeorgeAutonomous strip
    // send_email_draft from the tool list, so the guarantee is a missing tool
    // rather than a sentence in a prompt — which is the distinction that failed on
    // 2026-08-20, when this ran as "internal_only" and a prompt said sending was
    // allowed. Prose lost an argument with prose; absence cannot lose it.
    emailSendPolicy: "none",
  });

  if (result.summary) {
    const transcriptSummaryInsert = await admin.from("agent_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: result.summary,
    });
    if (transcriptSummaryInsert.error) {
      console.error("[process-event] transcript summary insert failed", { sessionId, error: transcriptSummaryInsert.error.message });
    }
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

  return { skipped: false, sessionId, status: finalStatus, error: result.error };
}

function buildTranscriptFramingPrompt(
  transcript: { id: string; title: string | null; customer_id: string | null },
  manager: ManagerContact | null,
): string {
  const managerLine = manager?.email
    ? `${manager.name ?? "your manager"} <${manager.email}>`
    : "your manager (none configured — note it in your summary)";
  const lines: string[] = [
    "A meeting your note-taker (Scribe) recorded just landed. Your job is to update",
    "what we know about this account from it.",
    "",
    "Scribe already summarises each meeting for the people who attended, so do not",
    "write a summary for anyone. Nothing you produce on this run goes to anybody —",
    "you have no send tool here, and that is deliberate. Your output is a better",
    "account record, not a message.",
    "",
    "## What to do",
    `1. Read the full transcript + insights: call \`read_transcript\` with transcript_id \`${transcript.id}\`.`,
    "2. Pull out what changes our picture of the account: decisions, commitments",
    "   (with owner and date), blockers, feature requests, how the room sounded, and",
    "   who actually showed up.",
    transcript.customer_id
      ? `3. This meeting is tied to customer \`${transcript.customer_id}\`. Write the changes through: \`update_onboarding_step\` for milestone progress, \`create_objective\` / \`update_objective\` for commitments either side made, \`mark_cadence_met\` if this was the scheduled check-in.`
      : "3. Identify the customer from the attendee addresses (`find_customer`, or `list_customers` if you need to look around) and tie the meeting to them, then write the changes through: `update_onboarding_step` for milestone progress, `create_objective` / `update_objective` for commitments either side made, `mark_cadence_met` if this was the scheduled check-in.",
    "4. Record a health signal with `record_health_check` — band, a plain-English",
    "   reason, and the specifics in `signals` (sentiment, blockers, feature requests,",
    "   attendance). This is how a meeting turns into something the team can see at a",
    "   glance. Only skip it if the transcript genuinely tells you nothing new.",
    "5. If something durable and reusable came up — a process, a product fact, a",
    "   recurring answer — stage it with `propose_knowledge`. Not customer-record",
    "   data; that belongs in the tools above.",
    `6. If something needs a person to decide, use \`raise_decision\` — it lands on the team's Needs-you queue, which is how ${managerLine} hears about it. That queue is the channel; there is no email to fall back on.`,
    "",
    "Finish by summarising what you changed and what you would want a human to look",
    "at. That summary is the run record the team reads — it is not an email and",
    "nobody is waiting on it, so keep it short and concrete.",
  ];
  return lines.join("\n");
}

async function resolveSenderToCustomer(
  orgId: string,
  fromAddress: string | null,
): Promise<string | null> {
  if (!fromAddress) return null;
  const email = fromAddress.toLowerCase().trim();
  const domain = email.split("@")[1] ?? null;
  if (!domain) return null;
  const admin = createSupabaseAdmin();

  // 1) Exact contact-email match — most specific signal.
  const contactRes = await admin
    .from("contacts")
    .select("customer_id")
    .eq("org_id", orgId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (contactRes.data?.customer_id) return contactRes.data.customer_id as string;

  // 2) Domain match on the customer itself (the partner's main domain).
  const customerRes = await admin
    .from("customers")
    .select("id")
    .eq("org_id", orgId)
    .ilike("domain", domain)
    .limit(1)
    .maybeSingle();
  if (customerRes.data?.id) return customerRes.data.id as string;

  return null;
}
