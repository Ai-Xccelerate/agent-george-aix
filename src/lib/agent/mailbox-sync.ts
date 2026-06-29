import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callAction } from "@/lib/composio/client";

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

export type MailboxSyncResult = {
  folders: number;
  messages_upserted: number;
  messages_removed: number;
  events_upserted: number;
  errors: string[];
};

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

export async function syncMailbox(orgId: string): Promise<MailboxSyncResult> {
  const result: MailboxSyncResult = {
    folders: 0,
    messages_upserted: 0,
    messages_removed: 0,
    events_upserted: 0,
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

  return result;
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
    }
    skip = tokenFrom(list["@odata.nextLink"], "skiptoken");
  } while (skip);

  return count;
}
