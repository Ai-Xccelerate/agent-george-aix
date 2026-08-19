/**
 * George's email tools, backed by its OWN Nylas mailbox.
 *
 * These replace the seven Outlook/Composio email tools. Tool NAMES, argument
 * shapes and return shapes are deliberately identical, so the system prompt, the
 * model's learned behaviour, the audit_log action names and the /inbox UI all
 * keep working unchanged — only the transport underneath differs. Calendar stays
 * on Composio for now; that is a separate migration.
 *
 * WHAT ACTUALLY CHANGES FOR A USER
 * Mail now comes from george@aiwkr.com — George's own address — instead of a
 * human team member's Outlook mailbox. Replies land in George's inbox rather
 * than that person's.
 *
 * THE OUTBOUND GUARD IS CARRIED OVER VERBATIM
 * send_email_draft may only send when every recipient is internal OR on the
 * org's approved domain allowlist. It is always on, in chat and autonomous runs
 * alike, and it fails CLOSED when recipients can't be read. That guard is the
 * defence against a prompt-injected agent exfiltrating by email, so it is
 * reimplemented here with the same rules rather than relaxed. It re-reads the
 * draft from the provider immediately before sending, so what it checks is what
 * is actually on the wire — not what the model claimed at draft time.
 *
 * One improvement the new transport allows: Nylas returns to/cc/bcc on a draft
 * directly, so bcc is now included in the recipient check. The Graph path only
 * parsed the fields it happened to select.
 */
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNylasClient,
  nylasConfig,
  recipientEmails,
  type NylasAddress,
  type NylasClient,
  type NylasMessage,
  type NylasEvent,
} from "@/lib/nylas/client";
import { wrapGeorgeEmailHtml, injectReplyHtml } from "@/lib/agent/email-branding";
import { isInternalAddress } from "@/lib/agent/identity";

type Ctx = {
  orgId: string;
  userId: string | null;
  sessionId: string | null;
  /**
   * Kept for signature parity with the Composio tools. It does NOT widen the
   * outbound guard — the allowlist is the only sanctioned way to do that.
   */
  emailSendPolicy?: "chat" | "internal_only";
  db: SupabaseClient;
};

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
 * The org's approved external domains. Fails CLOSED — a query error yields an
 * empty set, not "allow everything" — because send_email_draft treats this as an
 * allowlist, not a denylist.
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

/** Compact shape for the model — full Nylas payloads are far too verbose. */
function summarise(m: NylasMessage) {
  return {
    message_id: m.id,
    thread_id: m.thread_id,
    subject: m.subject ?? "",
    from: (m.from ?? []).map((a) => a.email),
    to: (m.to ?? []).map((a) => a.email),
    cc: (m.cc ?? []).map((a) => a.email),
    date: m.date ? new Date(m.date * 1000).toISOString() : null,
    unread: m.unread ?? null,
    snippet: (m.snippet ?? "").slice(0, 300),
    has_attachments: (m.attachments?.length ?? 0) > 0,
  };
}

const toAddresses = (list: string[] | undefined): NylasAddress[] =>
  (list ?? []).map((email) => ({ email }));

export function buildNylasEmailTools(ctx: Ctx) {
  const cfg = nylasConfig();
  // Callers gate on isNylasEnabled(); this keeps the type non-null and turns a
  // wiring mistake into one clear error rather than a crash per tool call.
  const nylas: NylasClient | null = cfg ? createNylasClient(cfg) : null;
  const selfAddress = (cfg?.fromEmail ?? "").toLowerCase();

  const notConfigured = () =>
    fail(
      "George's mailbox isn't configured (NYLAS_API_KEY / NYLAS_GRANT_ID missing), so email is unavailable.",
    );

  // ---- DRAFT NEW EMAIL ---------------------------------------------
  const draftEmail = tool(
    "draft_email",
    "Create a draft email in George's own mailbox. Returns the draft id + preview so you can show it to the user. The user MUST confirm before you call send_email_draft.",
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
      if (!nylas) return notConfigured();
      // Sign before storing: the audit snapshot must match what actually goes
      // out, while the chat preview stays on the agent's own words so the human
      // reviews content rather than boilerplate.
      const sentHtml = wrapGeorgeEmailHtml(input.body_html);
      const res = await nylas.createDraft({
        to: toAddresses(input.to),
        cc: toAddresses(input.cc),
        bcc: toAddresses(input.bcc),
        subject: input.subject,
        body: sentHtml,
      });
      if (!res.ok) return fail(res.error);

      await audit(ctx, "email.drafted", {
        draft_id: res.data.id,
        to: input.to,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        subject: input.subject,
        // Snapshotted so /inbox can always render the preview even after the
        // draft is sent or deleted at the provider.
        body_html: sentHtml,
      });

      return ok({
        draft_id: res.data.id,
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
    "Reply in an existing thread. Replies to ALL internal people on the thread (sender + To + Cc) and EXCLUDES any external customer/partner. Returns the draft id, the recipients it will go to, and `excluded_external` (external addresses left off). Surface excluded_external to the user and ask before adding anyone external. User MUST confirm before send_email_draft.",
    {
      message_id: z
        .string()
        .min(1)
        .describe("Message id from get_email / list_recent_emails."),
      body_html: z.string().min(1),
    },
    async ({ message_id, body_html }) => {
      if (!nylas) return notConfigured();

      // 1) Read the original so we reply to the internal people on the thread
      //    only — never auto-include an external customer.
      const orig = await nylas.getMessage(message_id);
      if (!orig.ok) return fail(orig.error);

      const fromPool = orig.data.from ?? [];
      const toPool = [...fromPool, ...(orig.data.to ?? [])];
      const ccPool = orig.data.cc ?? [];

      const seen = new Set<string>([selfAddress]);
      const internalOnly = (pool: NylasAddress[]): NylasAddress[] => {
        const out: NylasAddress[] = [];
        for (const r of pool) {
          const a = (r.email ?? "").toLowerCase();
          if (!a || !isInternalAddress(a) || seen.has(a)) continue;
          seen.add(a);
          out.push({ email: r.email, ...(r.name ? { name: r.name } : {}) });
        }
        return out;
      };

      let to = internalOnly(toPool);
      const cc = internalOnly(ccPool);
      // George is the sender, never an "external party we left off". Excluded
      // explicitly rather than relying on its own domain being configured as
      // internal — otherwise a misconfigured GEORGE_EMAIL makes George report
      // itself to the user as someone it declined to include.
      const excludedExternal = [
        ...new Set(
          [...toPool, ...ccPool]
            .map((r) => (r.email ?? "").toLowerCase())
            .filter((a) => a && a !== selfAddress && !isInternalAddress(a)),
        ),
      ];

      // External-only thread (nobody internal besides George): fall back to the
      // original sender so the reply is still valid, and flag it hard.
      const externalOnly = to.length === 0;
      if (externalOnly && fromPool.length) to = [fromPool[0]];
      if (to.length === 0) return fail("Couldn't determine anyone to reply to on this thread.");

      // 2) Top-post George's HTML above the quoted original, then create the
      //    draft with reply_to_message_id so the provider keeps it threaded.
      const quoted = orig.data.body ?? "";
      const sentHtml = injectReplyHtml(quoted, body_html);
      const subject = orig.data.subject?.startsWith("Re:")
        ? orig.data.subject
        : `Re: ${orig.data.subject ?? ""}`.trim();

      const res = await nylas.createDraft({
        to,
        cc,
        subject,
        body: sentHtml,
        replyToMessageId: message_id,
      });
      if (!res.ok) return fail(res.error);

      await audit(ctx, "email.reply_drafted", {
        draft_id: res.data.id,
        in_reply_to: message_id,
        thread_id: orig.data.thread_id ?? null,
        to: to.map((r) => r.email),
        cc: cc.map((r) => r.email),
        excluded_external: excludedExternal,
        reply_scope: externalOnly ? "external_fallback" : "internal_only",
        body_html: sentHtml,
      });

      return ok({
        draft_id: res.data.id,
        to: to.map((r) => r.email),
        cc: cc.map((r) => r.email),
        subject,
        excluded_external: excludedExternal,
        reply_scope: externalOnly ? "external_fallback" : "internal_only",
        preview: stripHtml(body_html).slice(0, 400),
      });
    },
  );

  // ---- SEND DRAFT ---------------------------------------------------
  const sendDraft = tool(
    "send_email_draft",
    "Send a previously created draft — every recipient must be internal OR on the org's approved domain allowlist (Settings → Agent George → Email domains). Anything else is always refused: those must be sent by a human from the mailbox Drafts folder, or you can call request_domain_approval to ask for that domain to be allowed. This holds in chat and in autonomous runs alike.",
    {
      draft_id: z.string().min(1),
    },
    async ({ draft_id }) => {
      if (!nylas) return notConfigured();

      // Hard guard, ALWAYS ON (chat + autonomous). Re-read the draft from the
      // provider so the check runs against the real recipients rather than
      // anything the model asserted earlier. Do NOT re-scope this behind
      // emailSendPolicy — the allowlist is the only sanctioned way to widen it,
      // and it is an explicit human approval per domain, not a policy flag.
      const draft = await nylas.getDraft(draft_id);
      if (!draft.ok) return fail(draft.error);

      // Includes bcc, unlike the old Graph path.
      const addresses = recipientEmails(draft.data);

      // Fail CLOSED: if recipients can't be read we cannot prove they are all
      // internal/approved, so refuse rather than risk it.
      if (addresses.length === 0) {
        await audit(ctx, "email.send_blocked", { draft_id, reason: "recipients_unparsed" });
        return fail(
          "Refused to send: couldn't confirm this draft's recipients are all internal or approved. " +
            "The draft is saved — a human can send it from the mailbox Drafts folder.",
        );
      }

      const external = addresses.filter((a) => !isInternalAddress(a));
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

      const res = await nylas.sendDraft(draft_id);
      if (!res.ok) return fail(res.error);

      await audit(ctx, "email.sent", {
        draft_id,
        message_id: res.data.id ?? null,
        external_approved: external,
      });
      return ok({ sent: true, draft_id, message_id: res.data.id ?? null });
    },
  );

  // ---- LIST INBOX --------------------------------------------------
  const listRecentEmails = tool(
    "list_recent_emails",
    "List recent messages from George's own inbox. Use to find a thread to reply in or to check who's written in. Returns most recent first.",
    {
      folder: z.enum(["inbox", "sent", "drafts"]).default("inbox").optional(),
      limit: z.number().int().min(1).max(50).default(20).optional(),
      unread_only: z.boolean().default(false).optional(),
    },
    async ({ folder, limit, unread_only }) => {
      if (!nylas) return notConfigured();

      // Nylas filters by folder id, not name, so resolve the name first. The six
      // system folders are provisioned with the mailbox.
      let folderId: string | undefined;
      const wanted = folder ?? "inbox";
      const folders = await nylas.listFolders();
      if (folders.ok) {
        const match = (folders.data ?? []).find(
          (f) =>
            (f.name ?? "").toLowerCase() === wanted ||
            (f.attributes ?? []).some((a) => a.toLowerCase() === `\\${wanted}`),
        );
        folderId = match?.id;
      }

      const res = await nylas.listMessages({
        limit: limit ?? 20,
        unread: unread_only ? true : undefined,
        in: folderId,
      });
      if (!res.ok) return fail(res.error);
      return ok({
        folder: wanted,
        // Say so explicitly rather than silently returning the whole mailbox —
        // otherwise "sent" quietly behaving like "all" would mislead the model.
        folder_resolved: folderId ? true : false,
        count: res.data.length,
        messages: res.data.map(summarise),
      });
    },
  );

  // ---- GET EMAIL ---------------------------------------------------
  const getEmail = tool(
    "get_email",
    "Fetch a single email by its message id — full body, participants, thread id.",
    {
      message_id: z.string().min(1),
    },
    async ({ message_id }) => {
      if (!nylas) return notConfigured();
      const res = await nylas.getMessage(message_id);
      if (!res.ok) return fail(res.error);
      return ok({
        ...summarise(res.data),
        // Plain text: the model reasons over content, and raw HTML wastes a
        // large amount of context on markup.
        body: stripHtml(res.data.body ?? "").slice(0, 20_000),
      });
    },
  );

  // ---- SEARCH EMAILS ----------------------------------------------
  const searchEmails = tool(
    "search_emails",
    "Search George's mailbox for messages matching a term — use it to check whether a contact actually sent what an objective is waiting on. Matches on sender, subject and body. Returns matches newest-first.",
    {
      query: z
        .string()
        .min(1)
        .describe(
          "Search term, e.g. an email address, a company name, or a subject keyword.",
        ),
      size: z.number().int().min(1).max(25).default(10).optional(),
    },
    async ({ query, size }) => {
      if (!nylas) return notConfigured();
      const res = await nylas.search(query, size ?? 10);
      if (!res.ok) return fail(res.error);
      return ok({ query, count: res.data.length, messages: res.data.map(summarise) });
    },
  );

  // ---- GET THREAD -------------------------------------------------
  const getThread = tool(
    "get_thread",
    "Fetch every message in a thread, oldest first — the full back-and-forth for a conversation.",
    {
      thread_id: z.string().min(1).describe("Thread id from get_email / list_recent_emails."),
      include_body: z.boolean().default(false).optional(),
    },
    async ({ thread_id, include_body }) => {
      if (!nylas) return notConfigured();
      const res = await nylas.listThreadMessages(thread_id);
      if (!res.ok) return fail(res.error);

      const ordered = [...res.data].sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
      return ok({
        thread_id,
        count: ordered.length,
        messages: ordered.map((m) => ({
          ...summarise(m),
          ...(include_body ? { body: stripHtml(m.body ?? "").slice(0, 8_000) } : {}),
        })),
      });
    },
  );

  // ---- CALENDAR: George owns its own, like any employee -------------
  // These previously ran against a team member's Outlook calendar, so every
  // event George booked landed on her calendar and invites came from her.
  // George's Nylas mailbox comes with its own primary calendar, so it now
  // schedules as itself.

  /** Resolve George's primary calendar. */
  const primaryCalendarId = async (): Promise<string | null> => {
    if (!nylas) return null;
    const res = await nylas.listCalendars();
    if (!res.ok) return null;
    const cals = res.data ?? [];
    return (cals.find((c) => c.is_primary) ?? cals[0])?.id ?? null;
  };

  const summariseEvent = (e: NylasEvent) => ({
    event_id: e.id,
    title: e.title ?? "",
    status: e.status ?? null,
    start: e.when?.start_time ? new Date(e.when.start_time * 1000).toISOString() : null,
    end: e.when?.end_time ? new Date(e.when.end_time * 1000).toISOString() : null,
    organizer: e.organizer?.email ?? null,
    participants: (e.participants ?? []).map((pt) => ({
      email: pt.email,
      status: pt.status ?? null,
    })),
  });

  const createCalendarEvent = tool(
    "create_calendar_event",
    "Create an event on George's own calendar and invite attendees. Use to schedule kickoffs, check-ins and reviews. Returns the event id and the invited participants.",
    {
      subject: z.string().min(1),
      start_iso: z.string().datetime().describe("ISO 8601 start time (with timezone)."),
      end_iso: z.string().datetime(),
      attendees: z.array(z.string().email()).default([]).optional(),
      body_html: z.string().optional(),
      online_meeting: z.boolean().default(true).optional(),
      customer_id: z
        .string()
        .uuid()
        .optional()
        .describe("If this event is for a known customer, pass their id so it is logged against them."),
    },
    async (input) => {
      if (!nylas) return notConfigured();
      const calendarId = await primaryCalendarId();
      if (!calendarId) return fail("Couldn't find George's calendar.");

      const start = Math.floor(new Date(input.start_iso).getTime() / 1000);
      const end = Math.floor(new Date(input.end_iso).getTime() / 1000);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return fail("start_iso / end_iso must be valid ISO 8601 timestamps.");
      }
      if (end <= start) return fail("The event must end after it starts.");

      const res = await nylas.createEvent({
        calendarId,
        title: input.subject,
        description: input.body_html ? stripHtml(input.body_html) : undefined,
        startTime: start,
        endTime: end,
        participants: (input.attendees ?? []).map((email) => ({ email })),
        // An event nobody is told about is not a meeting.
        notifyParticipants: true,
      });
      if (!res.ok) return fail(res.error);

      await audit(
        ctx,
        "calendar.event_created",
        {
          event_id: res.data.id,
          title: input.subject,
          start: input.start_iso,
          end: input.end_iso,
          attendees: input.attendees ?? [],
        },
        input.customer_id,
      );

      return ok({
        ...summariseEvent(res.data),
        // Stated plainly so the model never promises a join link that does not
        // exist: a Nylas-hosted calendar has no Teams/Meet bridge, so a video
        // link has to be put in the body by whoever has one.
        online_meeting_requested: input.online_meeting ?? true,
        conferencing: null,
        note: "No video-conferencing link was attached — George's calendar has no meeting bridge. Put a link in the body if one is needed.",
      });
    },
  );

  const listCalendarEvents = tool(
    "list_calendar_events",
    "List events on George's own calendar within a time window. Use to check what is already scheduled before proposing a time.",
    {
      start_iso: z.string().datetime().optional().describe("Window start. Defaults to now."),
      end_iso: z.string().datetime().optional().describe("Window end. Defaults to 14 days out."),
      limit: z.number().int().min(1).max(100).default(50).optional(),
    },
    async ({ start_iso, end_iso, limit }) => {
      if (!nylas) return notConfigured();
      const calendarId = await primaryCalendarId();
      if (!calendarId) return fail("Couldn't find George's calendar.");

      // Nylas requires both bounds for a timespan query, so default them
      // rather than surfacing an unhelpful provider error.
      const start = start_iso
        ? Math.floor(new Date(start_iso).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      const end = end_iso
        ? Math.floor(new Date(end_iso).getTime() / 1000)
        : start + 14 * 86_400;

      const res = await nylas.listEvents({ calendarId, start, end, limit: limit ?? 50 });
      if (!res.ok) return fail(res.error);

      const events = res.data
        .map(summariseEvent)
        .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
      return ok({
        window: {
          start: new Date(start * 1000).toISOString(),
          end: new Date(end * 1000).toISOString(),
        },
        count: events.length,
        events,
      });
    },
  );

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
