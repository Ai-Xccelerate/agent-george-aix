/**
 * Nylas transport for George's own mailbox.
 *
 * WHY THIS EXISTS
 * George's email has run through Composio against a shared Microsoft 365
 * mailbox. That has two problems: the mailbox belongs to a person (the default
 * in identity.ts is a human's address), and the Composio path is currently
 * failing outright on staging. Nylas Agent Accounts give George a mailbox of its
 * own — provisioned by API, no OAuth — so it sends as itself and receives its
 * own replies.
 *
 * Live mailbox: george@aiwkr.com, on a domain already verified for both
 * receiving and transactional send, with DKIM published.
 *
 * SELECTED BY ENV, LIKE EVERY OTHER BACKEND SWAP HERE
 * NYLAS_API_KEY + NYLAS_GRANT_ID present -> this transport is available.
 * Absent -> nothing here runs and George keeps using Composio. Same pattern as
 * DATABASE_URL and STORAGE_DRIVER: merge inert, flip deliberately, revert by
 * deleting a variable.
 *
 * FAIL OPEN, NEVER THROW
 * Every method resolves `{ ok: true, data }` or `{ ok: false, error }`. These
 * calls sit behind agent tools on the SSE chat path, so an unreachable mailbox
 * must degrade a turn, not break it — the same contract the Postgres shim and
 * the Parchment client hold to.
 *
 * THE DRAFT LIFECYCLE IS LOAD-BEARING
 * George's email policy (AGENTS.md, and the hard guard in the send tool) is:
 * draft -> show the human -> send only on explicit confirmation. So this exposes
 * createDraft / getDraft / sendDraft as separate operations rather than a single
 * send. `getDraft` exists specifically so the guard can re-read a draft's real
 * recipients immediately before sending, rather than trusting what the model
 * claimed when it created it.
 */

export type NylasAddress = { email: string; name?: string };

export type NylasMessage = {
  id: string;
  grant_id?: string;
  thread_id?: string;
  subject?: string;
  body?: string;
  snippet?: string;
  from?: NylasAddress[];
  to?: NylasAddress[];
  cc?: NylasAddress[];
  bcc?: NylasAddress[];
  reply_to?: NylasAddress[];
  /** Unix seconds. */
  date?: number;
  unread?: boolean;
  starred?: boolean;
  folders?: string[];
  attachments?: Array<{ id: string; filename?: string; content_type?: string; size?: number }>;
};

export type NylasDraft = NylasMessage & { object?: "draft" };

export type NylasThread = {
  id: string;
  subject?: string;
  snippet?: string;
  participants?: NylasAddress[];
  message_ids?: string[];
  latest_message_received_date?: number;
};

export type NylasFolder = { id: string; name?: string; attributes?: string[] };

export type NylasCalendar = {
  id: string;
  name?: string;
  timezone?: string;
  is_primary?: boolean;
  read_only?: boolean;
};

export type NylasEvent = {
  id: string;
  calendar_id?: string;
  title?: string;
  description?: string;
  status?: string;
  ical_uid?: string;
  organizer?: { name?: string; email?: string };
  participants?: Array<{ email: string; name?: string; status?: string }>;
  /** Nylas uses a tagged union; timespan is what we create. */
  when?: { object?: string; start_time?: number; end_time?: number };
  conferencing?: { provider?: string; details?: Record<string, unknown> };
};

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; status?: number };
export type NylasResult<T> = Ok<T> | Err;

export type NylasConfig = {
  base: string;
  apiKey: string;
  grantId: string;
  /** The address George sends from — informational; Nylas fills `from` itself. */
  fromEmail: string | null;
  fromName: string | null;
};

/**
 * The deployment's Nylas settings, or null when this transport is switched off.
 *
 * All three of URL, key and grant are required. A key without a grant has no
 * mailbox to act on; a grant without a key can't authenticate. Treating partial
 * configuration as "off" avoids an integration that looks enabled and fails on
 * every call — the same rule the Parchment client follows.
 */
export function nylasConfig(): NylasConfig | null {
  const base = (process.env.NYLAS_API_URL?.trim() || "https://api.us.nylas.com").replace(
    /\/+$/,
    "",
  );
  const apiKey = process.env.NYLAS_API_KEY?.trim();
  const grantId = process.env.NYLAS_GRANT_ID?.trim();
  if (!apiKey || !grantId) return null;
  return {
    base,
    apiKey,
    grantId,
    fromEmail: process.env.NYLAS_FROM_EMAIL?.trim() || null,
    fromName: process.env.NYLAS_FROM_NAME?.trim() || null,
  };
}

/** True when George has its own Nylas mailbox configured. */
export function isNylasEnabled(): boolean {
  return nylasConfig() !== null;
}

/** Which variables are missing, so a settings screen can explain itself. */
export function nylasMissingVars(): string[] {
  const missing: string[] = [];
  if (!process.env.NYLAS_API_KEY?.trim()) missing.push("NYLAS_API_KEY");
  if (!process.env.NYLAS_GRANT_ID?.trim()) missing.push("NYLAS_GRANT_ID");
  return missing;
}

/** Endpoints that return a collection, for the null-payload normalisation above. */
const COLLECTION_PATH = /(messages|threads|drafts|folders|calendars|events)$/;

/** Reads happen inside a chat turn, so they get a short leash. */
const READ_TIMEOUT_MS = 15_000;
/** Sends can be slower — the provider is doing real SMTP work. */
const WRITE_TIMEOUT_MS = 45_000;

type RequestOpts = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
};

async function request<T>(
  cfg: NylasConfig,
  path: string,
  opts: RequestOpts = {},
): Promise<NylasResult<T>> {
  // Every path is grant-scoped except the grant itself, so callers pass the
  // suffix and this builds the rest. Keeps the grant id in exactly one place.
  const url = new URL(`${cfg.base}/v3${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      // Mail changes when someone sends, not on a timer. A cached inbox listing
      // would make George answer about a stale mailbox.
      cache: "no-store",
    });

    const text = await res.text();

    if (!res.ok) {
      // Nylas returns {error: {type, message}} or {error_description}. Surface
      // the provider's own message where there is one — it is far more useful
      // than a status code when someone is reading George's logs at 2am.
      let detail = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as {
          error?: string | { message?: string; type?: string };
          error_description?: string;
        };
        const e = j.error;
        detail =
          (typeof e === "string" ? e : e?.message) ??
          j.error_description ??
          detail;
      } catch {
        /* keep the raw body */
      }

      const known: Record<number, string> = {
        401: "Nylas rejected the API key (401) — check NYLAS_API_KEY, and that it belongs to the same Nylas application as the grant.",
        403: "Nylas refused this call (403) — the key may lack scope for this operation.",
        404: "Not found in this Nylas mailbox (404) — the grant, message or draft id may be wrong, or belong to a different grant.",
        410: "This Nylas grant is no longer valid (410) — the mailbox may have been deleted and needs re-provisioning.",
        429: "Rate limited by Nylas (429) — back off and retry.",
      };
      return {
        ok: false,
        status: res.status,
        error: known[res.status] ? `${known[res.status]} ${detail}`.trim() : `Nylas returned ${res.status}: ${detail}`,
      };
    }

    if (!text) return { ok: true, data: undefined as T };
    // Nylas wraps successful payloads in {data, request_id}. Unwrap so callers
    // deal in domain objects, not envelopes.
    const parsed = JSON.parse(text) as { data?: T } | T;
    const data =
      parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>)
        ? ((parsed as { data: T }).data)
        : (parsed as T);
    // Nylas answers an empty collection with {"data": null} rather than [].
    // Callers are typed to receive an array, so a null made list tools throw on
    // an empty mailbox or calendar — breaking the never-throw contract this
    // module promises. Normalised once, here, so no caller has to remember.
    if (data === null && COLLECTION_PATH.test(path)) {
      return { ok: true, data: [] as unknown as T };
    }
    return { ok: true, data };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? `Nylas did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach Nylas: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type SendInput = {
  to: NylasAddress[];
  cc?: NylasAddress[];
  bcc?: NylasAddress[];
  subject: string;
  /** HTML. George's bodies are HTML; email-branding.ts wraps them. */
  body: string;
  /** Set to keep a reply threaded onto an existing conversation. */
  replyToMessageId?: string | null;
};

export function createNylasClient(cfg: NylasConfig) {
  const g = `/grants/${encodeURIComponent(cfg.grantId)}`;

  return {
    config: cfg,

    /** The mailbox itself — used as a health check and to confirm the address. */
    grant(): Promise<NylasResult<{ id: string; email?: string; grant_status?: string; name?: string }>> {
      return request(cfg, g, { timeoutMs: 8_000 });
    },

    /** Send immediately. Only used where a human has already confirmed. */
    send(input: SendInput): Promise<NylasResult<NylasMessage>> {
      return request(cfg, `${g}/messages/send`, {
        method: "POST",
        body: toWirePayload(input),
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },

    // ---- drafts: the confirm-before-send path -------------------------
    createDraft(input: SendInput): Promise<NylasResult<NylasDraft>> {
      return request(cfg, `${g}/drafts`, {
        method: "POST",
        body: toWirePayload(input),
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },

    /**
     * Re-read a draft. The send guard calls this to check the ACTUAL recipients
     * on the draft rather than trusting what the model said when creating it —
     * a prompt-injected agent could otherwise claim an internal recipient and
     * have an external one on the wire.
     */
    getDraft(draftId: string): Promise<NylasResult<NylasDraft>> {
      return request(cfg, `${g}/drafts/${encodeURIComponent(draftId)}`);
    },

    updateDraft(draftId: string, input: Partial<SendInput>): Promise<NylasResult<NylasDraft>> {
      return request(cfg, `${g}/drafts/${encodeURIComponent(draftId)}`, {
        method: "PUT",
        body: toWirePayload(input as SendInput),
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },

    sendDraft(draftId: string): Promise<NylasResult<NylasMessage>> {
      return request(cfg, `${g}/drafts/${encodeURIComponent(draftId)}`, {
        method: "POST",
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },

    deleteDraft(draftId: string): Promise<NylasResult<void>> {
      return request(cfg, `${g}/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
    },

    // ---- reading -----------------------------------------------------
    listMessages(
      opts: { limit?: number; unread?: boolean; in?: string; pageToken?: string } = {},
    ): Promise<NylasResult<NylasMessage[]>> {
      return request(cfg, `${g}/messages`, {
        params: {
          limit: Math.min(Math.max(opts.limit ?? 20, 1), 200),
          unread: opts.unread,
          in: opts.in,
          page_token: opts.pageToken,
        },
      });
    },

    getMessage(messageId: string): Promise<NylasResult<NylasMessage>> {
      return request(cfg, `${g}/messages/${encodeURIComponent(messageId)}`);
    },

    /**
     * Provider-native search. Nylas passes the query through to the underlying
     * mailbox, so syntax depends on the provider — for a Nylas-hosted account a
     * plain term works.
     */
    search(query: string, limit = 20): Promise<NylasResult<NylasMessage[]>> {
      return request(cfg, `${g}/messages`, {
        params: { search_query_native: query, limit: Math.min(Math.max(limit, 1), 100) },
      });
    },

    getThread(threadId: string): Promise<NylasResult<NylasThread>> {
      return request(cfg, `${g}/threads/${encodeURIComponent(threadId)}`);
    },

    listThreadMessages(threadId: string, limit = 50): Promise<NylasResult<NylasMessage[]>> {
      return request(cfg, `${g}/messages`, {
        params: { thread_id: threadId, limit: Math.min(Math.max(limit, 1), 200) },
      });
    },

    // ---- calendar: George owns its own, like any employee ------------
    listCalendars(): Promise<NylasResult<NylasCalendar[]>> {
      return request(cfg, `${g}/calendars`);
    },

    /**
     * Create an event. `notifyParticipants` defaults ON, because an event
     * nobody is told about is not a meeting. Tests against a real calendar
     * should pass false.
     */
    createEvent(args: {
      calendarId: string;
      title: string;
      description?: string;
      /** Unix seconds. */
      startTime: number;
      endTime: number;
      participants?: NylasAddress[];
      notifyParticipants?: boolean;
    }): Promise<NylasResult<NylasEvent>> {
      return request(cfg, `${g}/events`, {
        method: "POST",
        params: {
          calendar_id: args.calendarId,
          notify_participants: args.notifyParticipants ?? true,
        },
        body: {
          title: args.title,
          ...(args.description ? { description: args.description } : {}),
          when: { start_time: args.startTime, end_time: args.endTime },
          ...(args.participants?.length ? { participants: args.participants } : {}),
        },
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    },

    listEvents(args: {
      calendarId: string;
      /** Unix seconds. Nylas requires both bounds for a timespan query. */
      start?: number;
      end?: number;
      limit?: number;
    }): Promise<NylasResult<NylasEvent[]>> {
      return request(cfg, `${g}/events`, {
        params: {
          calendar_id: args.calendarId,
          start: args.start,
          end: args.end,
          limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
        },
      });
    },

    deleteEvent(eventId: string, calendarId: string): Promise<NylasResult<void>> {
      return request(cfg, `${g}/events/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        params: { calendar_id: calendarId, notify_participants: false },
      });
    },

    listFolders(): Promise<NylasResult<NylasFolder[]>> {
      return request(cfg, `${g}/folders`);
    },
  };
}

export type NylasClient = ReturnType<typeof createNylasClient>;

/**
 * Build the wire payload, dropping empty recipient arrays.
 *
 * Nylas rejects `cc: []` on some operations rather than ignoring it, and an
 * empty array is indistinguishable from "not specified" for our callers — so
 * omit rather than send empty.
 */
function toWirePayload(input: SendInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.subject !== undefined) body.subject = input.subject;
  if (input.body !== undefined) body.body = input.body;
  if (input.to?.length) body.to = input.to;
  if (input.cc?.length) body.cc = input.cc;
  if (input.bcc?.length) body.bcc = input.bcc;
  if (input.replyToMessageId) body.reply_to_message_id = input.replyToMessageId;
  return body;
}

/** Every address on a message, lowercased — what the outbound guard checks. */
export function recipientEmails(m: Pick<NylasMessage, "to" | "cc" | "bcc">): string[] {
  return [...(m.to ?? []), ...(m.cc ?? []), ...(m.bcc ?? [])]
    .map((r) => r?.email?.trim().toLowerCase())
    .filter((e): e is string => !!e);
}
