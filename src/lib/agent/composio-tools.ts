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
import { EMAIL_SENDING_EXPOSED } from "@/lib/features";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAction } from "@/lib/composio/client";
import { wrapGeorgeEmailHtml, injectReplyHtml } from "@/lib/agent/email-branding";
import { isInternalTo, resolveOrgIdentity, type OrgIdentity } from "@/lib/agent/identity";
import { checkSendRate, sendRateMessage } from "@/lib/agent/outbound-limits";

type Ctx = {
  orgId: string;
  userId: string | null;
  /**
   * The chat session this tool call is running inside. Forwarded into
   * audit_log so /inbox can link an outbound draft/send row back to its
   * originating chat conversation.
   */
  sessionId: string | null;
  /**
   * "chat" (default): a human confirmed the send, no guard. "internal_only":
   * autonomous run — send_email_draft refuses any draft whose recipients
   * aren't all @aixccelerate.com, so George can't email a customer without review.
   */
  emailSendPolicy?: "chat" | "internal_only";
  db: SupabaseClient;
};

type Recipient = { address: string; name?: string };

/** Pull {address, name} pairs out of a Graph recipient array (or string[]). */
function extractRecipients(list: unknown): Recipient[] {
  if (!Array.isArray(list)) return [];
  const out: Recipient[] = [];
  for (const r of list) {
    const ea =
      (r as { emailAddress?: { address?: string; name?: string } })?.emailAddress ??
      (typeof r === "string" ? { address: r } : undefined);
    if (ea?.address) out.push({ address: ea.address, name: ea.name });
  }
  return out;
}

function recipientAddresses(msg: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["toRecipients", "ccRecipients", "bccRecipients"]) {
    const arr = msg[key];
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      const ea = (r as { emailAddress?: { address?: string } })?.emailAddress;
      const addr = ea?.address ?? (typeof r === "string" ? r : null);
      if (addr) out.push(addr.toLowerCase());
    }
  }
  return out;
}

function externalRecipients(identity: OrgIdentity, addresses: string[]): string[] {
  return addresses.filter((a) => !isInternalTo(identity, a));
}

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

/**
 * The org's approved external domains (Settings → Agent George → Email
 * domains, or George's own request_domain_approval tool). Fails closed —
 * a query error yields an empty set, not "allow everything" — since
 * send_email_draft treats this as an allowlist, not a denylist.
 */
async function approvedDomains(ctx: Ctx): Promise<Set<string>> {
  const { data, error } = await ctx.db
    .from("domain_allowlist")
    .select("domain")
    .eq("org_id", ctx.orgId)
    .eq("status", "approved");
  if (error || !data) return new Set();
  return new Set(data.map((r: { domain: string }) => r.domain.toLowerCase()));
}

export function buildComposioTools(ctx: Ctx) {
  // ---- DRAFT NEW EMAIL ---------------------------------------------
  const draftEmail = tool(
    "draft_email",
    "Create a draft email in the mailbox George operates from. Returns the draft id + preview so you can show it to the user. The user MUST confirm before you call send_email_draft.",
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
      // Composio's OUTLOOK_CREATE_DRAFT schema is flat snake_case — NOT
      // Microsoft Graph's shape. `body` is a plain string with a sibling
      // `is_html` flag, and recipients are `to_recipients`/`cc_recipients`/
      // `bcc_recipients`. Sending Graph-style keys (toRecipients, a nested
      // body object) gets silently dropped by Composio, which is why drafts
      // failed/came through empty.
      // Append George's branded signature before sending. The chat preview
      // below stays on the agent's own text so the user reviews content, not
      // boilerplate.
      const sentHtml = wrapGeorgeEmailHtml(input.body_html);
      const res = await callAction("OUTLOOK_CREATE_DRAFT", ctx.orgId, {
        to_recipients: input.to,
        cc_recipients: input.cc ?? [],
        bcc_recipients: input.bcc ?? [],
        subject: input.subject,
        body: sentHtml,
        is_html: true,
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
        // deleted (Outlook returns ErrorItemNotFound). Store the signed
        // version so the viewer matches what actually went out.
        body_html: sentHtml,
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
    "Reply in an existing Outlook thread. Replies to ALL internal people on the thread (sender + To + Cc) and EXCLUDES any external customer/partner. Returns the draft id, the recipients it will go to, and `excluded_external` (external addresses left off). Surface excluded_external to the user and ask before adding anyone external. User MUST confirm before send_email_draft.",
    {
      message_id: z.string().min(1).describe("Outlook message id (from get_email / list_recent_emails)."),
      body_html: z.string().min(1),
    },
    async ({ message_id, body_html }) => {
      // 1) Read the original's participants so we can reply-all to the internal
      //    people on the thread only — never auto-include an external customer.
      const orig = await callAction<Record<string, unknown>>(
        "OUTLOOK_GET_MESSAGE",
        ctx.orgId,
        { message_id, select: ["from", "toRecipients", "ccRecipients"] },
      );
      const om = ((orig.ok ? (orig.data?.data ?? orig.data) : null) ?? {}) as {
        from?: { emailAddress?: { address?: string; name?: string } };
        toRecipients?: unknown;
        ccRecipients?: unknown;
      };
      const fromRecip: Recipient[] = om.from?.emailAddress?.address
        ? [{ address: om.from.emailAddress.address, name: om.from.emailAddress.name }]
        : [];
      const toPool = [...fromRecip, ...extractRecipients(om.toRecipients)];
      const ccPool = extractRecipients(om.ccRecipients);

      // Internal-only, de-duped, never George himself.
      const identity = await resolveOrgIdentity(ctx.db, ctx.orgId);
      const seen = new Set<string>([identity.address.toLowerCase()]);
      const internalOnly = (pool: Recipient[]): Recipient[] => {
        const out: Recipient[] = [];
        for (const r of pool) {
          const a = r.address.toLowerCase();
          if (!isInternalTo(identity, a) || seen.has(a)) continue;
          seen.add(a);
          out.push({ address: r.address, ...(r.name ? { name: r.name } : {}) });
        }
        return out;
      };
      let toRecipients = internalOnly(toPool);
      const ccRecipients = internalOnly(ccPool);
      const excludedExternal = [
        ...new Set(
          [...toPool, ...ccPool]
            .map((r) => r.address)
            .filter((a) => !isInternalTo(identity, a)),
        ),
      ];
      // External-only thread (no internal besides George): fall back to the
      // original sender so the reply is still valid, and flag it hard.
      const externalOnly = toRecipients.length === 0;
      if (externalOnly && fromRecip.length) toRecipients = [fromRecip[0]];

      // 2) Create the reply draft WITHOUT a comment (the reply action's comment
      //    is plain-text only; HTML there shows literal tags). This seeds the
      //    quoted thread + conversationId; we set the HTML body + recipients next.
      const res = await callAction("OUTLOOK_CREATE_DRAFT_REPLY", ctx.orgId, {
        message_id,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      const draftId = (res.data as { id?: string }).id;
      if (!draftId) return fail("Couldn't create the reply draft.");

      // 3) Read the seeded draft body (quoted original) so we can top-post
      //    George's HTML reply above it. Degrade to just George's message if
      //    the fetch fails.
      const got = await callAction<Record<string, unknown>>(
        "OUTLOOK_GET_MESSAGE",
        ctx.orgId,
        { message_id: draftId, select: ["body"] },
      );
      const gotBody = ((got.ok ? (got.data?.data ?? got.data) : null) ??
        {}) as { body?: { content?: string } };
      const sentHtml = injectReplyHtml(
        gotBody.body?.content ?? "",
        wrapGeorgeEmailHtml(body_html),
      );

      // 4) Patch body + recipients. Recipient arrays are replace-on-write, so
      //    setting both to the internal set strips the external addresses the
      //    reply was seeded with.
      const updated = await callAction("OUTLOOK_UPDATE_EMAIL", ctx.orgId, {
        message_id: draftId,
        body: { contentType: "HTML", content: sentHtml },
        to_recipients: toRecipients,
        cc_recipients: ccRecipients,
      });
      if (!updated.ok) return fail(connectHintIfNeeded(updated.error, "Outlook"));

      await audit(ctx, "email.reply_drafted", {
        draft_id: draftId,
        message_id,
        to: toRecipients.map((r) => r.address),
        cc: ccRecipients.map((r) => r.address),
        excluded_external: excludedExternal,
        // Snapshot the signed body so the outbound viewer matches what's sent.
        body_html: sentHtml,
      });
      return ok({
        draft_id: draftId,
        in_reply_to: message_id,
        to: toRecipients.map((r) => r.address),
        cc: ccRecipients.map((r) => r.address),
        excluded_external: excludedExternal,
        reply_scope: externalOnly ? "external_fallback" : "internal_only",
        // Preview stays on the agent's own text, not the quoted thread.
        preview: stripHtml(body_html).slice(0, 400),
      });
    },
  );

  // ---- SEND DRAFT --------------------------------------------------
  const sendDraft = tool(
    "send_email_draft",
    "Send a previously created draft — every recipient must be internal to this organisation OR on its approved domain allowlist (Settings → Agent George → Email domains). Anything else is always refused: those must be sent by a human from the mailbox Drafts folder, or you can call request_domain_approval to ask for that domain to be allowed. This holds in chat and in autonomous runs alike.",
    {
      draft_id: z.string().min(1),
    },
    async ({ draft_id }) => {
      // Hard guard, ALWAYS ON (chat + autonomous): this tool may only send
      // drafts whose recipients are ALL internal or on the approved-domain
      // allowlist. Anything else requires an explicit human action (mailbox
      // Drafts → Send), so a prompt injection driving George to read
      // untrusted content can never exfiltrate via an auto-send. Do NOT
      // re-scope this behind emailSendPolicy again — the allowlist is the
      // only sanctioned way to widen it, and it's an explicit human
      // approval per domain, not a policy flag.
      // Same volume limit as the Nylas path. This route is inactive while
      // Nylas is configured, but it becomes George's mailbox again the moment
      // NYLAS_API_KEY is absent — so the cap has to live on both.
      const mode = ctx.emailSendPolicy === "internal_only" ? "autonomous" : "chat";
      const rate = await checkSendRate(ctx.db, ctx.orgId, mode);
      if (!rate.allowed) {
        await audit(ctx, "email.send_blocked", {
          draft_id,
          reason: "rate_limited",
          sent_last_hour: rate.sent,
          cap: rate.cap,
          mode: rate.mode,
        });
        return fail(sendRateMessage(rate));
      }

      const draft = await callAction<Record<string, unknown>>(
        "OUTLOOK_GET_MESSAGE",
        ctx.orgId,
        { message_id: draft_id },
      );
      if (!draft.ok) return fail(connectHintIfNeeded(draft.error, "Outlook"));
      const body = (draft.data?.data ?? draft.data ?? {}) as Record<string, unknown>;
      const addresses = recipientAddresses(body);
      // Fail CLOSED: if we can't positively read the recipients, we can't
      // prove they're all internal/approved — refuse rather than risk it.
      if (addresses.length === 0) {
        await audit(ctx, "email.send_blocked", { draft_id, reason: "recipients_unparsed" });
        return fail(
          "Refused to send: couldn't confirm this draft's recipients are all internal or approved. " +
            "The draft is saved — a human can send it from the mailbox Drafts folder.",
        );
      }
      const identity = await resolveOrgIdentity(ctx.db, ctx.orgId);
      const external = externalRecipients(identity, addresses);
      if (external.length > 0) {
        const allowed = await approvedDomains(ctx);
        const notAllowed = external.filter(
          (a) => !allowed.has((a.split("@")[1] ?? "").toLowerCase()),
        );
        if (notAllowed.length > 0) {
          await audit(ctx, "email.send_blocked", { draft_id, external, not_allowed: notAllowed });
          return fail(
            `Refused to send: this draft has recipient(s) on a domain that isn't approved [${notAllowed.join(", ")}]. ` +
              "You can only send to internal or org-approved domains directly. The draft is saved — " +
              "tell the user to review it and send it from the mailbox Drafts folder, or call request_domain_approval " +
              "if that domain should be allowed going forward.",
          );
        }
      }
      const res = await callAction("OUTLOOK_SEND_DRAFT", ctx.orgId, {
        message_id: draft_id,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      await audit(ctx, "email.sent", { draft_id, external_approved: external });
      return ok({ sent: true, draft_id });
    },
  );

  // ---- LIST INBOX --------------------------------------------------
  const listRecentEmails = tool(
    "list_recent_emails",
    "List recent messages from the mailbox George operates from. Use to find a thread to reply in or to check who has written in. Returns most recent first.",
    {
      folder: z.enum(["inbox", "sent", "drafts"]).default("inbox").optional(),
      limit: z.number().int().min(1).max(50).default(20).optional(),
      unread_only: z.boolean().default(false).optional(),
    },
    async ({ folder, limit, unread_only }) => {
      const res = await callAction("OUTLOOK_LIST_MESSAGES", ctx.orgId, {
        folder: folder ?? "inbox",
        top: limit ?? 20,
        is_read: unread_only ? false : undefined,
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
        message_id,
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
    "Create an event on George's calendar. Use to schedule kickoffs, check-ins, etc. Returns the new event id and join URL if it is a Teams meeting.",
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
        start_datetime: input.start_iso,
        end_datetime: input.end_iso,
        time_zone: "UTC",
        attendees_info: (input.attendees ?? []).map((email) => ({
          email,
          type: "required",
        })),
        body: input.body_html ?? undefined,
        is_html: input.body_html ? true : undefined,
        is_online_meeting: input.online_meeting ?? true,
        online_meeting_provider: "teamsForBusiness",
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
    "List George's upcoming calendar events. Use to check availability or find an existing meeting.",
    {
      start_iso: z.string().datetime().optional().describe("Defaults to now."),
      end_iso: z.string().datetime().optional().describe("Defaults to 14 days from now."),
      limit: z.number().int().min(1).max(100).default(50).optional(),
    },
    async ({ start_iso, end_iso, limit }) => {
      const start = start_iso ?? new Date().toISOString();
      const end =
        end_iso ?? new Date(Date.now() + 14 * 86400000).toISOString();
      // OUTLOOK_LIST_EVENTS is the slug that actually resolves; the older
      // OUTLOOK_CALENDAR_LIST_EVENTS no longer exists in the toolkit and
      // errored on every call. It has no startDateTime/endDateTime params —
      // the date range has to be expressed as an OData `filter` string.
      const res = await callAction("OUTLOOK_LIST_EVENTS", ctx.orgId, {
        filter: `start/dateTime ge '${start}' and end/dateTime le '${end}'`,
        top: limit ?? 50,
      });
      if (!res.ok) return fail(connectHintIfNeeded(res.error, "Outlook"));
      return ok(res.data);
    },
  );

  // Meeting transcripts are handled by Scribe (a remote MCP server wired into
  // the agent runtime), not Composio — see src/lib/agent/scribe.ts.

  // send_email_draft is registered ONLY when sending is exposed.
  //
  // Absent, not present-and-refusing. The tool, its guards
  // (`sendDraftGuarded` — allowlist plus volume ceiling) and their tests are
  // all still here and still run; George simply has no way to reach them. That
  // ordering is deliberate: the guards are the expensive part and they rot if
  // they stop being exercised, while a capability that exists alongside prose
  // saying "do not use it" is not a control — see the 20 August incident in
  // integration-toggle.ts, where exactly that shape sent 16 emails.
  //
  // Flipping EMAIL_SENDING_EXPOSED puts it back with the guards unchanged.
  return [
    draftEmail,
    draftReply,
    ...(EMAIL_SENDING_EXPOSED ? [sendDraft] : []),
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
