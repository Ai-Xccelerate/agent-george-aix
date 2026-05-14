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

type Ctx = { orgId: string; userId: string | null; db: SupabaseClient };

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
    payload,
  });
}

export function buildComposioTools(ctx: Ctx) {
  // ---- DRAFT NEW EMAIL ---------------------------------------------
  const draftEmail = tool(
    "draft_email",
    "Create a draft email in george@onyx's Outlook. Returns the draft id + preview so you can show it to the user. The user MUST confirm before you call send_email_draft.",
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
        subject: input.subject,
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
    "List recent messages from george@onyx's inbox. Use to find a thread to reply in or to check who's written in. Returns most recent first.",
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

  // ---- CREATE CALENDAR EVENT --------------------------------------
  const createCalendarEvent = tool(
    "create_calendar_event",
    "Create an event on george@onyx's calendar. Use to schedule kickoffs, check-ins, etc. Returns the new event id and join URL if it's a Teams meeting.",
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
    "List george@onyx's upcoming calendar events. Use to check availability or find an existing meeting.",
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

  // ---- FIREFLIES: list transcripts --------------------------------
  const listMeetingTranscripts = tool(
    "list_meeting_transcripts",
    "List recent meeting transcripts from Fireflies. Useful for catching up on a kickoff or weekly check-in George didn't attend.",
    {
      limit: z.number().int().min(1).max(50).default(10).optional(),
      from_iso: z.string().datetime().optional().describe("Only transcripts after this date."),
    },
    async ({ limit, from_iso }) => {
      const res = await callAction(
        "FIREFLIES_LIST_TRANSCRIPTS",
        ctx.orgId,
        {
          limit: limit ?? 10,
          fromDate: from_iso,
        },
      );
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Fireflies"));
      return ok(res.data);
    },
  );

  // ---- FIREFLIES: get transcript ----------------------------------
  const getMeetingTranscript = tool(
    "get_meeting_transcript",
    "Fetch the full transcript + summary for a Fireflies meeting by id. Use this immediately after a kickoff or check-in to extract decisions, action items, and dates.",
    {
      transcript_id: z.string().min(1),
      customer_id: z.string().uuid().optional().describe("Customer the meeting was about — used for audit logging."),
    },
    async ({ transcript_id, customer_id }) => {
      const res = await callAction("FIREFLIES_GET_TRANSCRIPT", ctx.orgId, {
        transcriptId: transcript_id,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Fireflies"));
      await audit(
        ctx,
        "fireflies.transcript_fetched",
        { transcript_id },
        customer_id,
      );
      return ok(res.data);
    },
  );

  return [
    draftEmail,
    draftReply,
    sendDraft,
    listRecentEmails,
    getEmail,
    createCalendarEvent,
    listCalendarEvents,
    listMeetingTranscripts,
    getMeetingTranscript,
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
