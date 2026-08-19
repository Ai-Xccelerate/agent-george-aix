import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callAction } from "@/lib/composio/client";
import { isSenderAllowed } from "./sender-allowlist";
import { isNylasEnabled } from "@/lib/nylas/client";
import { syncNylasMailbox } from "./nylas-mailbox-sync";

/**
 * Mirrors George's M365 mailbox + calendar into Supabase (mail_folders,
 * email_messages, calendars, calendar_events). The mirror is the source
 * George reasons over and the data the /mailbox + /calendar UI render from.
 *
 * Mechanism (all via Composio's Outlook toolkit, verified against the live
 * account):
 *   - Mail: per-folder delta (OUTLOOK_GET_MAIL_DELTA accepts folder_id). The
 *     first call on a folder returns every message + an @odata.deltaLink; later
 *     calls pass the stored delta token and return only changes. So one
 *     mechanism serves both the initial backfill and incremental sync, and it
 *     covers Sent Items (delta is per-folder, not Inbox-only).
 *   - Calendar: list events (OUTLOOK_LIST_EVENTS) and upsert.
 *
 * Idempotent: every upsert keys on (org_id, external_id), so a re-run or an
 * overlap with the webhook converges instead of duplicating.
 */

const FOLDER_PAGE = 100;
const MSG_PAGE = 50;
const EVENT_PAGE = 100;
// Folders Outlook reports as ours-sent; messages in them are outbound.
const OUTBOUND_FOLDERS = new Set(["sent items", "drafts", "outbox"]);

// How often the periodic catch-up sync runs per org — the single source of
// truth for both the scheduler's throttle (cron-tick.ts) and any "next sync"
// estimate shown in the UI (mailbox page).
export const MAILBOX_SYNC_INTERVAL_MS = 10 * 60_000;

export type MailboxSyncResult = {
  folders: number;
  messages_upserted: number;
  messages_removed: number;
  events_upserted: number;
  /** Fresh inbound emails enqueued as agent_events for George to act on. */
  events_enqueued: number;
  errors: string[];
};

// Backstop window: only enqueue inbound email received within this window, so
// the initial mirror backfill of old mail doesn't trigger a flood of runs.
const ENQUEUE_WINDOW_MS = 6 * 60 * 60_000;
const ENQUEUE_MAX_PER_RUN = 25;

type GraphList = {
  value?: unknown[];
  ["@odata.nextLink"]?: string;
  ["@odata.deltaLink"]?: string;
};

/** Pull $skiptoken / $deltatoken out of a Graph @odata.* URL. */
function tokenFrom(link: string | undefined, name: "skiptoken" | "deltatoken"): string | null {
  if (!link) return null;
  try {
    const sp = new URL(link).searchParams;
    return sp.get(`$${name}`) ?? sp.get(name);
  } catch {
    return null;
  }
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Mirror the mailbox George is actually using.
 *
 * George owns its own mailbox now, so when Nylas is configured the mirror must
 * read from there — otherwise /mailbox keeps showing a team member's Outlook
 * while George sends from its own address, which is worse than showing nothing.
 *
 * Kept as a dispatcher under the original name so the three callers (the cron
 * tick, the Sync now button, and the Composio OAuth callback) are untouched.
 * Composio stays available: remove the Nylas env vars and this reverts.
 */
export async function syncMailbox(orgId: string): Promise<MailboxSyncResult> {
  if (isNylasEnabled()) return syncNylasMailbox(orgId);
  return syncOutlookMailbox(orgId);
}

/** The original Composio/Microsoft Graph mirror. */
export async function syncOutlookMailbox(orgId: string): Promise<MailboxSyncResult> {
  const result: MailboxSyncResult = {
    folders: 0,
    messages_upserted: 0,
    messages_removed: 0,
    events_upserted: 0,
    events_enqueued: 0,
    errors: [],
  };
  const admin = createSupabaseAdmin();

  // ── Folders ──────────────────────────────────────────────────────────────
  const folders: Array<{ id: string; name: string; outbound: boolean; deltaToken: string | null }> = [];
  try {
    let skip: string | null = null;
    do {
      const res = await callAction<GraphList>("OUTLOOK_LIST_MAIL_FOLDERS", orgId, {
        top: FOLDER_PAGE,
        ...(skip ? { skip_token: skip } : {}),
      });
      if (!res.ok) throw new Error(res.error);
      const list = res.data ?? {};
      for (const raw of list.value ?? []) {
        const f = asObj(raw);
        const id = f.id as string;
        if (!id) continue;
        const name = (f.displayName as string) ?? "";
        const wk = ((f.wellKnownName as string) ?? name).toLowerCase();
        folders.push({ id, name, outbound: OUTBOUND_FOLDERS.has(wk), deltaToken: null });
        await admin.from("mail_folders").upsert(
          {
            org_id: orgId,
            external_id: id,
            parent_external_id: (f.parentFolderId as string) ?? null,
            display_name: name,
            well_known_name: (f.wellKnownName as string) ?? null,
            total_item_count: (f.totalItemCount as number) ?? null,
            unread_item_count: (f.unreadItemCount as number) ?? null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "org_id,external_id" },
        );
      }
      skip = tokenFrom(list["@odata.nextLink"], "skiptoken");
    } while (skip);
    result.folders = folders.length;
  } catch (err) {
    result.errors.push(`folders: ${err instanceof Error ? err.message : String(err)}`);
    return result; // can't sync messages without folders
  }

  // Load any stored delta tokens so we fetch only changes per folder.
  const { data: stored } = await admin
    .from("mail_folders")
    .select("external_id, delta_link")
    .eq("org_id", orgId);
  const tokenByFolder = new Map<string, string | null>(
    (stored ?? []).map((r) => [r.external_id as string, (r.delta_link as string) ?? null]),
  );

  // ── Messages, per folder ───────────────────────────────────────────────────
  for (const folder of folders) {
    try {
      let deltaToken = tokenByFolder.get(folder.id) ?? null;
      let skipToken: string | null = null;
      let nextDeltaLink: string | undefined;

      // Page until Graph hands back a deltaLink (end of this sync window).
      for (let guard = 0; guard < 1000; guard++) {
        const args: Record<string, unknown> = { folder_id: folder.id, top: MSG_PAGE };
        if (skipToken) args.skip_token = skipToken;
        else if (deltaToken) args.delta_token = deltaToken;

        const res = await callAction<GraphList>("OUTLOOK_GET_MAIL_DELTA", orgId, args);
        if (!res.ok) throw new Error(res.error);
        const list = res.data ?? {};

        for (const raw of list.value ?? []) {
          const m = asObj(raw);
          const id = m.id as string;
          if (!id) continue;
          if ("@removed" in m) {
            await admin.from("email_messages").delete().eq("org_id", orgId).eq("external_id", id);
            result.messages_removed++;
            continue;
          }
          await upsertMessage(admin, orgId, folder, m);
          result.messages_upserted++;
        }

        const nextSkip = tokenFrom(list["@odata.nextLink"], "skiptoken");
        if (nextSkip) {
          skipToken = nextSkip;
          deltaToken = null;
          continue;
        }
        nextDeltaLink = list["@odata.deltaLink"];
        break;
      }

      const newDelta = tokenFrom(nextDeltaLink, "deltatoken");
      await admin
        .from("mail_folders")
        .update({
          delta_link: newDelta ?? tokenByFolder.get(folder.id) ?? null,
          backfill_complete: true,
          synced_at: new Date().toISOString(),
        })
        .eq("org_id", orgId)
        .eq("external_id", folder.id);
    } catch (err) {
      result.errors.push(`folder ${folder.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Calendar ────────────────────────────────────────────────────────────────
  try {
    result.events_upserted = await syncCalendar(admin, orgId);
  } catch (err) {
    result.errors.push(`calendar: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Enqueue fresh inbound for George ─────────────────────────────────────────
  // Backstop for the Composio real-time trigger: turn newly-mirrored inbound
  // mail into agent_events so George acts on it even if the webhook is down.
  try {
    result.events_enqueued = await enqueueFreshInbound(admin, orgId);
  } catch (err) {
    result.errors.push(`enqueue: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Turn recently-mirrored inbound emails into pending `agent_events` so the cron
 * sweep runs George on them. Independent of the Composio webhook (which may not
 * be subscribed). Guards:
 *   - only inbound received within ENQUEUE_WINDOW_MS (no backfill flood),
 *   - only allowlisted senders,
 *   - skips any message a prior run or the webhook already enqueued (dedup on
 *     the Graph message id, checked across event sources).
 */
async function enqueueFreshInbound(admin: Admin, orgId: string): Promise<number> {
  const cutoff = new Date(Date.now() - ENQUEUE_WINDOW_MS).toISOString();
  const { data: candidates } = await admin
    .from("email_messages")
    .select("external_id, from_address, received_at")
    .eq("org_id", orgId)
    .eq("direction", "inbound")
    .gte("received_at", cutoff)
    .order("received_at", { ascending: false })
    .limit(ENQUEUE_MAX_PER_RUN);
  const rows = (candidates ?? []) as Array<{
    external_id: string;
    from_address: string | null;
    received_at: string | null;
  }>;
  if (rows.length === 0) return 0;

  // Message ids we've already turned into events (either path). The webhook
  // keys events on Composio's delivery id, so also match the message id it
  // stashes under payload.data.id.
  const sinceDay = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: existing } = await admin
    .from("agent_events")
    .select("source_event_id, payload")
    .eq("org_id", orgId)
    .gte("created_at", sinceDay);
  const seen = new Set<string>();
  for (const e of (existing ?? []) as Array<{
    source_event_id: string | null;
    payload: Record<string, unknown> | null;
  }>) {
    if (e.source_event_id) seen.add(e.source_event_id);
    const pid = ((e.payload?.data as Record<string, unknown> | undefined)?.id as string) ?? null;
    if (pid) seen.add(pid);
  }

  let enqueued = 0;
  for (const m of rows) {
    if (seen.has(m.external_id)) continue;
    const decision = await isSenderAllowed(orgId, m.from_address);
    if (!decision.allowed) continue;
    const ins = await admin
      .from("agent_events")
      .insert({
        org_id: orgId,
        source: "mailbox_sync",
        source_event_id: m.external_id,
        event_type: "OUTLOOK_MESSAGE_TRIGGER",
        payload: { data: { id: m.external_id }, source: "mailbox_sync" },
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    // 23505 = a concurrent run/webhook already enqueued it; treat as success.
    if (ins.error && ins.error.code !== "23505") {
      throw ins.error;
    }
    if (!ins.error) enqueued++;
    seen.add(m.external_id);
  }
  return enqueued;
}

type Admin = ReturnType<typeof createSupabaseAdmin>;

async function upsertMessage(
  admin: Admin,
  orgId: string,
  folder: { id: string; outbound: boolean },
  m: Record<string, unknown>,
) {
  const from = asObj(asObj(m.from).emailAddress);
  const body = asObj(m.body);
  await admin.from("email_messages").upsert(
    {
      org_id: orgId,
      external_id: m.id as string,
      internet_message_id: (m.internetMessageId as string) ?? null,
      folder_external_id: folder.id,
      conversation_id: (m.conversationId as string) ?? null,
      direction: folder.outbound ? "outbound" : "inbound",
      subject: (m.subject as string) ?? null,
      body_preview: (m.bodyPreview as string) ?? null,
      body_html: (body.content as string) ?? null,
      body_content_type: (body.contentType as string) ?? null,
      from_address: (from.address as string) ?? null,
      from_name: (from.name as string) ?? null,
      to_recipients: m.toRecipients ?? [],
      cc_recipients: m.ccRecipients ?? [],
      bcc_recipients: m.bccRecipients ?? [],
      is_read: (m.isRead as boolean) ?? false,
      is_draft: (m.isDraft as boolean) ?? false,
      has_attachments: (m.hasAttachments as boolean) ?? false,
      importance: (m.importance as string) ?? null,
      web_link: (m.webLink as string) ?? null,
      received_at: (m.receivedDateTime as string) ?? null,
      sent_at: (m.sentDateTime as string) ?? null,
      raw: m,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "org_id,external_id" },
  );
}

/** Graph datetimes come as { dateTime, timeZone }; store best-effort + keep raw. */
function graphDate(v: unknown): { iso: string | null; tz: string | null } {
  const d = asObj(v);
  const dt = d.dateTime as string | undefined;
  const tz = (d.timeZone as string) ?? null;
  if (!dt) return { iso: null, tz };
  // Graph emits no offset; treat UTC-labelled times as UTC, else leave naive.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(dt) ? dt : tz === "UTC" ? `${dt}Z` : dt;
  return { iso, tz };
}

async function syncCalendar(admin: Admin, orgId: string): Promise<number> {
  // Mirror the calendar list (metadata only for now).
  const cals = await callAction<GraphList>("OUTLOOK_LIST_CALENDARS", orgId, {});
  if (cals.ok) {
    for (const raw of cals.data?.value ?? []) {
      const c = asObj(raw);
      const id = c.id as string;
      if (!id) continue;
      await admin.from("calendars").upsert(
        {
          org_id: orgId,
          external_id: id,
          name: (c.name as string) ?? null,
          is_default: (c.isDefaultCalendar as boolean) ?? false,
          can_edit: (c.canEdit as boolean) ?? false,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "org_id,external_id" },
      );
    }
  }

  // Events from the default calendar. (Multi-calendar event sync is a
  // follow-on; the default calendar is George's working calendar.)
  let count = 0;
  let skip: string | null = null;
  do {
    const res = await callAction<GraphList>("OUTLOOK_LIST_EVENTS", orgId, {
      top: EVENT_PAGE,
      ...(skip ? { skip_token: skip } : {}),
    });
    if (!res.ok) throw new Error(res.error);
    const list = res.data ?? {};
    for (const raw of list.value ?? []) {
      const e = asObj(raw);
      const id = e.id as string;
      if (!id) continue;
      const start = graphDate(e.start);
      const end = graphDate(e.end);
      const organizer = asObj(asObj(e.organizer).emailAddress);
      await admin.from("calendar_events").upsert(
        {
          org_id: orgId,
          external_id: id,
          ical_uid: (e.iCalUId as string) ?? null,
          subject: (e.subject as string) ?? null,
          body_preview: (e.bodyPreview as string) ?? null,
          body_html: (asObj(e.body).content as string) ?? null,
          location: (asObj(e.location).displayName as string) ?? null,
          is_all_day: (e.isAllDay as boolean) ?? false,
          is_cancelled: (e.isCancelled as boolean) ?? false,
          start_at: start.iso,
          end_at: end.iso,
          start_timezone: start.tz,
          end_timezone: end.tz,
          organizer_address: (organizer.address as string) ?? null,
          organizer_name: (organizer.name as string) ?? null,
          attendees: e.attendees ?? [],
          recurrence: e.recurrence ?? null,
          series_master_external_id: (e.seriesMasterId as string) ?? null,
          event_type: (e.type as string) ?? null,
          online_meeting_url:
            (e.onlineMeetingUrl as string) ?? (asObj(e.onlineMeeting).joinUrl as string) ?? null,
          web_link: (e.webLink as string) ?? null,
          response_status: (asObj(e.responseStatus).response as string) ?? null,
          raw: e,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "org_id,external_id" },
      );
      count++;

      // Auto-accept: any invite George hasn't responded to yet gets accepted so
      // it lands on the calendar without manual RSVP. "notResponded" excludes
      // events he organizes ("organizer") and ones already actioned, so this
      // only fires once per invite. Best-effort — a failure just retries next sync.
      const resp = (asObj(e.responseStatus).response as string) ?? null;
      if (resp === "notResponded" && !(e.isCancelled as boolean)) {
        const accepted = await callAction("OUTLOOK_ACCEPT_EVENT", orgId, {
          event_id: id,
          response_type: "accept",
          send_response: true,
        });
        if (accepted.ok) {
          await admin
            .from("calendar_events")
            .update({ response_status: "accepted" })
            .eq("org_id", orgId)
            .eq("external_id", id);
        }
      }
    }
    skip = tokenFrom(list["@odata.nextLink"], "skiptoken");
  } while (skip);

  return count;
}
