/**
 * George's Composio-backed tools — email (M365 Outlook), calendar, and Fireflies.
 *
 * These are MCP tool definitions returned to `buildGeorgeMcpServer` so they
 * sit alongside the Supabase tools. Each tool wraps a Composio action and
 * audits externally-visible outcomes to `audit_log`.
 *
 * Confirmation pattern for email: George DRAFTS first (returns the draft id
 * + preview to the user), then calls `send_email_draft` only after the user
 * says "send it". The system prompt makes this rule explicit so the model
 * doesn't auto-send.
 */
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAction } from "@/lib/composio/client";

type Ctx = {
  orgId: string;
  userId: string | null;
  /**
   * The chat session this tool call is running inside. Forwarded into
   * audit_log so /inbox can link an outbound draft/send row back to its
   * originating chat conversation.
   */
  sessionId: string | null;
  db: SupabaseClient;
};

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

async function audit(
  ctx: Ctx,
  action: string,
  payload: Record<string, unknown>,
  customerId?: string,
) {
  await ctx.db.from("audit_log").insert({
    org_id: ctx.orgId,
    actor: "george",
    action,
    customer_id: customerId ?? null,
    session_id: ctx.sessionId ?? null,
    payload,
  });
}

export function buildComposioTools(ctx: Ctx) {
  // ---- DRAFT NEW EMAIL ---------------------------------------------
  const draftEmail = tool(
    "draft_email",
    "Create a draft email in agent.george@getonyx.ai's Outlook. Returns the draft id + preview so you can show it to the user. The user MUST confirm before you call send_email_draft.",
    {
      to: z.array(z.string().email()).min(1),
      cc: z.array(z.string().email()).optional(),
      bcc: z.array(z.string().email()).optional(),
      subject: z.string().min(1),
      body_html: z
        .string()
        .min(1)
        .describe("HTML body. Use simple inline tags only (<p>, <br>, <ul>, <a>)."),
    },
    async (input) => {
      // Composio's Outlook actions follow Microsoft Graph's shape: the
      // body has to be `{ contentType, content }`, not a top-level string
      // with a sibling `contentType`. With the wrong shape the action
      // silently sent the raw HTML as plain text — recipients saw <p> tags
      // in the email. Same nesting is already used by the calendar event
      // call below; keep them consistent.
      const res = await callAction("OUTLOOK_CREATE_DRAFT", ctx.orgId, {
        toRecipients: input.to,
        ccRecipients: input.cc ?? [],
        bccRecipients: input.bcc ?? [],
        subject: input.subject,
        body: { contentType: "HTML", content: input.body_html },
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      const data = res.data as { id?: string; message?: { id?: string } };
      const draftId = data.id ?? data.message?.id;
      await audit(ctx, "email.drafted", {
        draft_id: draftId,
        to: input.to,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        subject: input.subject,
        // Snapshot the body at draft time so the /inbox/outbound/[id]
        // viewer can always render a clean HTML preview, even if the
        // Outlook draft is later sent (id moves to Sent Items) or
        // deleted (Outlook returns ErrorItemNotFound).
        body_html: input.body_html,
      });
      return ok({
        draft_id: draftId,
        to: input.to,
        cc: input.cc ?? [],
        subject: input.subject,
        preview: stripHtml(input.body_html).slice(0, 400),
      });
    },
  );

  // ---- DRAFT REPLY -------------------------------------------------
  const draftReply = tool(
    "draft_email_reply",
    "Create a reply draft to an existing message in the same Outlook thread. Returns the draft id + preview; user MUST confirm before send_email_draft.",
    {
      message_id: z.string().min(1).describe("Outlook message id (from get_email / list_recent_emails)."),
      body_html: z.string().min(1),
      reply_all: z.boolean().default(false).optional(),
    },
    async ({ message_id, body_html, reply_all }) => {
      const slug = reply_all
        ? "OUTLOOK_CREATE_REPLY_ALL_DRAFT"
        : "OUTLOOK_CREATE_DRAFT_REPLY";
      const res = await callAction(slug, ctx.orgId, {
        messageId: message_id,
        comment: body_html,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      const data = res.data as { id?: string };
      const draftId = data.id;
      await audit(ctx, "email.reply_drafted", {
        draft_id: draftId,
        message_id,
        reply_all: !!reply_all,
        // Snapshot for the outbound viewer (see note in draft_email).
        body_html,
      });
      return ok({
        draft_id: draftId,
        in_reply_to: message_id,
        preview: stripHtml(body_html).slice(0, 400),
      });
    },
  );

  // ---- SEND DRAFT --------------------------------------------------
  const sendDraft = tool(
    "send_email_draft",
    "Send a previously created draft. ONLY call this after the user has explicitly confirmed the draft (e.g. 'send it', 'looks good, send'). Never call autonomously.",
    {
      draft_id: z.string().min(1),
    },
    async ({ draft_id }) => {
      const res = await callAction("OUTLOOK_SEND_DRAFT", ctx.orgId, {
        messageId: draft_id,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      await audit(ctx, "email.sent", { draft_id });
      return ok({ sent: true, draft_id });
    },
  );

  // ---- LIST INBOX --------------------------------------------------
  const listRecentEmails = tool(
    "list_recent_emails",
    "List recent messages from agent.george@getonyx.ai's inbox. Use to find a thread to reply in or to check who's written in. Returns most recent first.",
    {
      folder: z.enum(["inbox", "sent", "drafts"]).default("inbox").optional(),
      limit: z.number().int().min(1).max(50).default(20).optional(),
      unread_only: z.boolean().default(false).optional(),
    },
    async ({ folder, limit, unread_only }) => {
      const res = await callAction("OUTLOOK_LIST_MESSAGES", ctx.orgId, {
        folder: folder ?? "inbox",
        top: limit ?? 20,
        filter: unread_only ? "isRead eq false" : undefined,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      return ok(res.data);
    },
  );

  // ---- GET EMAIL ---------------------------------------------------
  const getEmail = tool(
    "get_email",
    "Fetch a single email by its Outlook message id — full body, headers, conversation thread id.",
    {
      message_id: z.string().min(1),
    },
    async ({ message_id }) => {
      const res = await callAction("OUTLOOK_GET_MESSAGE", ctx.orgId, {
        messageId: message_id,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      return ok(res.data);
    },
  );

  // ---- SEARCH EMAILS ----------------------------------------------
  const searchEmails = tool(
    "search_emails",
    "Search George's Outlook mailbox with a KQL query — across folders, by sender (from:), recipient (to:/cc:), subject, date (received:), and attachments (hasattachment:yes), with AND/OR. Use this to find whether a contact actually sent what an objective is waiting on (e.g. 'from:vlad@nobletech.com AND hasattachment:yes AND received>=2026-06-20'). Returns matches newest-first.",
    {
      query: z
        .string()
        .min(1)
        .describe(
          "KQL query, e.g. 'from:user@example.com AND subject:logo' or 'received>today-7 AND hasattachment:yes'.",
        ),
      size: z.number().int().min(1).max(25).default(10).optional(),
    },
    async ({ query, size }) => {
      const res = await callAction("OUTLOOK_SEARCH_MESSAGES", ctx.orgId, {
        query,
        size: size ?? 10,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      return ok(res.data);
    },
  );

  // ---- GET THREAD -------------------------------------------------
  const getThread = tool(
    "get_thread",
    "Fetch the messages in an Outlook conversation by conversation_id (from get_email / list_recent_emails / search_emails, or an objective's thread_conversation_id). Returns both received (inbox) and sent messages in the thread so you can judge whether an objective was ACTUALLY achieved — the deliverable arrived — not merely replied to. Checks attachments too.",
    {
      conversation_id: z.string().min(1),
      include_body: z
        .boolean()
        .default(true)
        .optional()
        .describe("Include full body (true) or just metadata + preview (false)."),
    },
    async ({ conversation_id, include_body }) => {
      const select =
        include_body === false
          ? ["id", "subject", "from", "toRecipients", "receivedDateTime", "hasAttachments", "conversationId"]
          : ["id", "subject", "from", "toRecipients", "receivedDateTime", "hasAttachments", "conversationId", "bodyPreview", "body"];
      // OData string literals escape single quotes by doubling them.
      const filter = `conversationId eq '${conversation_id.replace(/'/g, "''")}'`;
      const [inbox, sent] = await Promise.all([
        callAction("OUTLOOK_QUERY_EMAILS", ctx.orgId, {
          folder: "inbox",
          filter,
          select,
          top: 50,
          orderby: "receivedDateTime asc",
        }),
        callAction("OUTLOOK_QUERY_EMAILS", ctx.orgId, {
          folder: "sentitems",
          filter,
          select,
          top: 50,
          orderby: "receivedDateTime asc",
        }),
      ]);
      if (!inbox.ok && !sent.ok) {
        return fail(connectHintIfNeeded(inbox.error, "Outlook"));
      }
      return ok({
        conversation_id,
        inbox: inbox.ok ? inbox.data : { error: inbox.error },
        sent: sent.ok ? sent.data : { error: sent.error },
      });
    },
  );

  // ---- CREATE CALENDAR EVENT --------------------------------------
  const createCalendarEvent = tool(
    "create_calendar_event",
    "Create an event on agent.george@getonyx.ai's calendar. Use to schedule kickoffs, check-ins, etc. Returns the new event id and join URL if it's a Teams meeting.",
    {
      subject: z.string().min(1),
      start_iso: z.string().datetime().describe("ISO 8601 start time (with timezone)."),
      end_iso: z.string().datetime(),
      attendees: z.array(z.string().email()).default([]).optional(),
      body_html: z.string().optional(),
      online_meeting: z.boolean().default(true).optional(),
      customer_id: z.string().uuid().optional().describe("If this event is for a known customer, pass their id so it's logged against them."),
    },
    async (input) => {
      const res = await callAction("OUTLOOK_CALENDAR_CREATE_EVENT", ctx.orgId, {
        subject: input.subject,
        start: { dateTime: input.start_iso, timeZone: "UTC" },
        end: { dateTime: input.end_iso, timeZone: "UTC" },
        attendees: (input.attendees ?? []).map((email) => ({
          emailAddress: { address: email },
          type: "required",
        })),
        body: input.body_html
          ? { contentType: "HTML", content: input.body_html }
          : undefined,
        isOnlineMeeting: input.online_meeting ?? true,
        onlineMeetingProvider: "teamsForBusiness",
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      await audit(
        ctx,
        "calendar.event_created",
        {
          subject: input.subject,
          start: input.start_iso,
          attendees: input.attendees ?? [],
          response: res.data,
        },
        input.customer_id,
      );
      return ok(res.data);
    },
  );

  // ---- LIST CALENDAR ----------------------------------------------
  const listCalendarEvents = tool(
    "list_calendar_events",
    "List agent.george@getonyx.ai's upcoming calendar events. Use to check availability or find an existing meeting.",
    {
      start_iso: z.string().datetime().optional().describe("Defaults to now."),
      end_iso: z.string().datetime().optional().describe("Defaults to 14 days from now."),
      limit: z.number().int().min(1).max(100).default(50).optional(),
    },
    async ({ start_iso, end_iso, limit }) => {
      const start = start_iso ?? new Date().toISOString();
      const end =
        end_iso ?? new Date(Date.now() + 14 * 86400000).toISOString();
      const res = await callAction("OUTLOOK_CALENDAR_LIST_EVENTS", ctx.orgId, {
        startDateTime: start,
        endDateTime: end,
        top: limit ?? 50,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      return ok(res.data);
    },
  );

  // Meeting transcripts are handled by Scribe (a remote MCP server wired into
  // the agent runtime), not Composio — see src/lib/agent/scribe.ts.

  return [
    draftEmail,
    draftReply,
    sendDraft,
    listRecentEmails,
    getEmail,
    searchEmails,
    getThread,
    createCalendarEvent,
    listCalendarEvents,
  ];
}

// Friendly error: when Composio reports the account isn't connected, tell the
// model so it can ask the user to wire it up instead of looping.
function connectHintIfNeeded(error: string, provider: string): string {
  const e = error.toLowerCase();
  if (
    e.includes("no connected account") ||
    e.includes("not connected") ||
    e.includes("connection not found") ||
    e.includes("unauthorized")
  ) {
    return `${provider} isn't connected yet for this org. Ask the user to visit /settings/integrations and connect via Composio. (${error})`;
  }
  return `${provider} error: ${error}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
