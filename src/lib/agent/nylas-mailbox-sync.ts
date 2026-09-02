/**
 * Mirror George's own mailbox and calendar into Postgres.
 *
 * WHY A MIRROR AT ALL
 * The /mailbox screen reads `email_messages` and `mail_folders` from our own
 * database — it never calls the provider. So the screen only shows George's
 * inbox once something fills those tables. Until now the only filler was the
 * Outlook sync, which means /mailbox has been showing a team member's mailbox
 * while George sends from its own.
 *
 * It matters more than a normal cache: a Nylas agent mailbox has no webmail to
 * log into, so this mirror is the ONLY way a human can see what George sent and
 * received.
 *
 * THIS IS A BACKSTOP, NOT THE PRIMARY PATH
 * /api/webhooks/nylas handles mail in real time. This exists to catch whatever a
 * missed webhook dropped, and to backfill. That is why it needs no delta tokens:
 * Graph has them and Nylas doesn't, but a windowed pull is sufficient for a
 * backstop and is simpler than the Outlook implementation it replaces.
 *
 * Deliberately writes the SAME tables and the same column shapes as
 * mailbox-sync.ts, so /mailbox, /mailbox/[id] and the flag action work unchanged.
 */
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNylasClient,
  nylasConfig,
  type NylasEvent,
  type NylasMessage,
} from "@/lib/nylas/client";
import { isSenderAllowed } from "./sender-allowlist";
import { resolveInboundOrg } from "./inbound-org";

type Admin = SupabaseClient;

export type NylasSyncResult = {
  folders: number;
  messages_upserted: number;
  messages_removed: number;
  events_upserted: number;
  events_enqueued: number;
  errors: string[];
};

/** How far back a mirror run looks. The webhook covers the live case. */
const SYNC_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Cap per run so a large mailbox can't stall the cron tick. */
const MESSAGE_LIMIT = 200;
/** Only enqueue very recent inbound, so a backfill can't trigger a flood. */
const ENQUEUE_WINDOW_MS = 6 * 60 * 60_000;
const ENQUEUE_MAX_PER_RUN = 25;
/** Calendar window: a fortnight each way is enough for scheduling context. */
const CALENDAR_PAST_MS = 7 * 24 * 60 * 60_000;
const CALENDAR_FUTURE_MS = 30 * 24 * 60 * 60_000;

/** Folder names that mean "George sent this", for the direction column. */
const OUTBOUND_FOLDERS = new Set(["sent", "sent items", "drafts"]);

export async function syncNylasMailbox(orgId: string): Promise<NylasSyncResult> {
  const result: NylasSyncResult = {
    folders: 0,
    messages_upserted: 0,
    messages_removed: 0,
    events_upserted: 0,
    events_enqueued: 0,
    errors: [],
  };

  const cfg = nylasConfig();
  if (!cfg) {
    result.errors.push("Nylas is not configured (NYLAS_API_KEY / NYLAS_GRANT_ID).");
    return result;
  }
  const nylas = createNylasClient(cfg);
  const admin = createSupabaseAdmin();
  const selfAddress = (cfg.fromEmail ?? "").toLowerCase();

  // ── Folders ────────────────────────────────────────────────────────────
  // Six system folders come with the mailbox. Mirrored first because messages
  // reference folder ids and /mailbox renders the folder list.
  const folderById = new Map<string, { name: string; outbound: boolean }>();
  const folders = await nylas.listFolders();
  if (!folders.ok) {
    // Without folders we can't attribute direction, so stop rather than write
    // rows we'd have to correct later.
    result.errors.push(`folders: ${folders.error}`);
    return result;
  }
  for (const f of folders.data) {
    const name = f.name ?? "";
    const key = name.toLowerCase();
    const attrs = (f.attributes ?? []).map((a) => a.toLowerCase());
    const outbound =
      OUTBOUND_FOLDERS.has(key) ||
      attrs.includes("\\sent") ||
      attrs.includes("\\drafts");
    folderById.set(f.id, { name, outbound });

    const up = await admin.from("mail_folders").upsert(
      {
        org_id: orgId,
        external_id: f.id,
        parent_external_id: null,
        display_name: name,
        // Nylas exposes role via attributes (\Inbox, \Sent …); normalise to the
        // same lowercase word the Outlook path stored, so UI filters still match.
        well_known_name: attrs.find((a) => a.startsWith("\\"))?.slice(1) ?? (key || null),
        total_item_count: null,
        unread_item_count: null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "org_id,external_id" },
    );
    if (up.error) result.errors.push(`folder ${name}: ${up.error.message}`);
  }
  result.folders = folderById.size;

  // A mirror should reflect the provider, so drop folders that no longer exist
  // there. This also clears folders left behind by the previous Outlook mirror —
  // without it the UI shows two Inbox rows and an operator cannot tell which
  // mailbox they are looking at.
  try {
    const { data: existingFolders } = await admin
      .from("mail_folders")
      .select("external_id")
      .eq("org_id", orgId);
    const stale = ((existingFolders ?? []) as Array<{ external_id: string }>)
      .map((f) => f.external_id)
      .filter((id) => !folderById.has(id));
    for (const id of stale) {
      // Messages first: they reference the folder and would otherwise be
      // unreachable rows pointing at a folder the UI no longer lists.
      await admin
        .from("email_messages")
        .delete()
        .eq("org_id", orgId)
        .eq("folder_external_id", id);
      await admin.from("mail_folders").delete().eq("org_id", orgId).eq("external_id", id);
      result.messages_removed++;
    }
  } catch (err) {
    result.errors.push(
      `folder cleanup: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Messages ───────────────────────────────────────────────────────────
  // One windowed pull across the mailbox rather than per-folder paging: Nylas
  // returns folder membership on each message, so a single pass is enough and
  // avoids N requests for six folders.
  const since = Math.floor((Date.now() - SYNC_WINDOW_MS) / 1000);
  const messages = await nylas.listMessages({ limit: MESSAGE_LIMIT });
  if (!messages.ok) {
    result.errors.push(`messages: ${messages.error}`);
  } else {
    for (const m of messages.data) {
      if (!m.id) continue;
      // Cheap client-side window: the endpoint has no received_after filter we
      // rely on, and the cap above already bounds the work.
      if (typeof m.date === "number" && m.date < since) continue;
      try {
        await upsertMessage(admin, orgId, m, folderById, selfAddress);
        result.messages_upserted++;
      } catch (err) {
        result.errors.push(
          `message ${m.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ── Calendar ───────────────────────────────────────────────────────────
  try {
    const cals = await nylas.listCalendars();
    if (cals.ok) {
      for (const c of cals.data) {
        await admin.from("calendars").upsert(
          {
            org_id: orgId,
            external_id: c.id,
            name: c.name ?? null,
            is_default: c.is_primary ?? false,
            can_edit: !(c.read_only ?? false),
            synced_at: new Date().toISOString(),
          },
          { onConflict: "org_id,external_id" },
        );
      }
      const primary = cals.data.find((c) => c.is_primary) ?? cals.data[0];
      if (primary) {
        const events = await nylas.listEvents({
          calendarId: primary.id,
          start: Math.floor((Date.now() - CALENDAR_PAST_MS) / 1000),
          end: Math.floor((Date.now() + CALENDAR_FUTURE_MS) / 1000),
          limit: 200,
        });
        if (events.ok) {
          for (const e of events.data) {
            try {
              await upsertEvent(admin, orgId, primary.id, e);
              result.events_upserted++;
            } catch (err) {
              result.errors.push(
                `event ${e.id}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } else {
          result.errors.push(`events: ${events.error}`);
        }
      }
    } else {
      result.errors.push(`calendars: ${cals.error}`);
    }
  } catch (err) {
    result.errors.push(`calendar: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Backstop: turn fresh inbound into work ─────────────────────────────
  try {
    result.events_enqueued = await enqueueFreshInbound(admin, orgId);
  } catch (err) {
    result.errors.push(`enqueue: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Write one message in the same shape the Outlook mirror used, so nothing
 * downstream has to know which provider it came from.
 *
 * Direction is decided by the sender rather than the folder: a message George
 * sent is outbound wherever it happens to sit, and folder membership on a
 * threaded reply can be ambiguous. Falls back to the folder when the sender
 * can't be read.
 */
async function upsertMessage(
  admin: Admin,
  orgId: string,
  m: NylasMessage,
  folderById: Map<string, { name: string; outbound: boolean }>,
  selfAddress: string,
) {
  const folderId = m.folders?.[0] ?? null;
  const folder = folderId ? folderById.get(folderId) : undefined;
  const fromAddress = m.from?.[0]?.email ?? null;

  const direction =
    fromAddress && selfAddress
      ? fromAddress.toLowerCase() === selfAddress
        ? "outbound"
        : "inbound"
      : folder?.outbound
        ? "outbound"
        : "inbound";

  const iso = typeof m.date === "number" ? new Date(m.date * 1000).toISOString() : null;

  const { error } = await admin.from("email_messages").upsert(
    {
      org_id: orgId,
      external_id: m.id,
      // Nylas doesn't surface the RFC Message-ID, so this stays null. Nothing
      // reads it today; the Outlook path populated it opportunistically.
      internet_message_id: null,
      folder_external_id: folderId,
      conversation_id: m.thread_id ?? null,
      direction,
      subject: m.subject ?? null,
      body_preview: m.snippet ?? null,
      body_html: m.body ?? null,
      body_content_type: m.body ? "html" : null,
      from_address: fromAddress,
      from_name: m.from?.[0]?.name ?? null,
      // Stored as jsonb; keep Nylas' {email,name} shape — the UI reads
      // addresses out of it generically.
      to_recipients: m.to ?? [],
      cc_recipients: m.cc ?? [],
      bcc_recipients: m.bcc ?? [],
      is_read: !(m.unread ?? false),
      is_draft: false,
      has_attachments: (m.attachments?.length ?? 0) > 0,
      // No Nylas equivalent for either.
      importance: null,
      web_link: null,
      received_at: direction === "inbound" ? iso : null,
      sent_at: direction === "outbound" ? iso : null,
      raw: m as unknown as Record<string, unknown>,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "org_id,external_id" },
  );
  if (error) throw error;
}

async function upsertEvent(
  admin: Admin,
  orgId: string,
  calendarId: string,
  e: NylasEvent,
) {
  const start = e.when?.start_time ? new Date(e.when.start_time * 1000).toISOString() : null;
  const end = e.when?.end_time ? new Date(e.when.end_time * 1000).toISOString() : null;

  const { error } = await admin.from("calendar_events").upsert(
    {
      org_id: orgId,
      external_id: e.id,
      calendar_external_id: calendarId,
      ical_uid: e.ical_uid ?? null,
      subject: e.title ?? null,
      body_preview: e.description ? e.description.slice(0, 500) : null,
      body_html: null,
      location: null,
      is_all_day: e.when?.object === "date",
      is_cancelled: e.status === "cancelled",
      start_at: start,
      end_at: end,
      start_timezone: null,
      end_timezone: null,
      organizer_address: e.organizer?.email ?? null,
      organizer_name: e.organizer?.name ?? null,
      attendees: e.participants ?? [],
      recurrence: null,
      series_master_external_id: null,
      event_type: null,
      online_meeting_url: null,
      web_link: null,
      response_status: null,
      raw: e as unknown as Record<string, unknown>,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "org_id,external_id" },
  );
  if (error) throw error;
}

/**
 * Turn recently-mirrored inbound mail into pending `agent_events`, so the cron
 * sweep runs George on anything the webhook missed.
 *
 * Same guards as the Outlook version: a short window so a backfill can't flood,
 * the sender allowlist, and dedupe against messages an earlier run or the
 * webhook already enqueued.
 */
async function enqueueFreshInbound(admin: Admin, orgId: string): Promise<number> {
  const cutoff = new Date(Date.now() - ENQUEUE_WINDOW_MS).toISOString();
  const { data: candidates } = await admin
    .from("email_messages")
    .select("external_id, from_address, received_at, conversation_id")
    .eq("org_id", orgId)
    .eq("direction", "inbound")
    .gte("received_at", cutoff)
    .order("received_at", { ascending: false })
    .limit(ENQUEUE_MAX_PER_RUN);

  const allCandidates = (candidates ?? []) as Array<{
    external_id: string;
    from_address: string | null;
    conversation_id: string | null;
  }>;

  // George does not wake himself.
  //
  // His own address is internal, so the allowlist admits it, and anything
  // he sends to the mailbox he reads comes back as inbound. That is a loop
  // with no natural end: a run that mails the mailbox schedules the next
  // run. It has not fired only because inbound has been off.
  //
  // It nearly fired here: three test sends from the outbound-guard proof sat
  // in the inbox waiting for the sync to be restored. Releasing a backlog
  // the moment a block lifts is exactly the 2026-08-20 sequence.
  const self = (process.env.GEORGE_EMAIL || process.env.NYLAS_FROM_EMAIL || "")
    .trim()
    .toLowerCase();
  const rows = allCandidates.filter((r) => {
    const from = (r.from_address ?? "").trim().toLowerCase();
    if (self && from === self) {
      console.log("[nylas sync] skipping self-sent message", { id: r.external_id });
      return false;
    }
    return true;
  });
  if (rows.length === 0) return 0;

  // The webhook keys its event on the Nylas delivery id, not the message id, so
  // also match the message id it stores in the payload — otherwise a message
  // could be processed twice.
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
    const data = e.payload?.data as Record<string, unknown> | undefined;
    const direct = data?.id as string | undefined;
    if (direct) seen.add(direct);
    const nested = (data?.object as Record<string, unknown> | undefined)?.id as string | undefined;
    if (nested) seen.add(nested);
  }

  let enqueued = 0;
  for (const m of rows) {
    if (seen.has(m.external_id)) continue;

    // Which tenant this message BELONGS to, which is not the same question as
    // whose mailbox it was mirrored from.
    //
    // The event used to be stamped with the sweep's org — the single org the
    // shared credential resolves to. That makes the answer depend on which org
    // happens to have the integration row connected, so a reply to a touchpoint
    // in another tenant lands in the wrong one and matches nothing. The webhook
    // was fixed to resolve from the message; the sync is the same path by
    // another route and needs the same answer.
    const attribution = await resolveInboundOrg(admin, {
      threadId: m.conversation_id,
      fromAddress: m.from_address,
    });
    const targetOrg = attribution.orgId;
    if (!targetOrg) {
      console.warn("[nylas sync] cannot attribute mirrored message to an org", {
        id: m.external_id,
        from: m.from_address,
        detail: attribution.detail,
      });
      continue;
    }

    // The allowlist is asked about the org that will own the work, not about
    // whoever's mailbox mirrored it.
    const decision = await isSenderAllowed(targetOrg, m.from_address);
    if (!decision.allowed) continue;

    const ins = await admin
      .from("agent_events")
      .insert({
        org_id: targetOrg,
        source: "mailbox_sync",
        source_event_id: m.external_id,
        event_type: "NYLAS_NEW_MESSAGE",
        payload: { data: { id: m.external_id }, source: "mailbox_sync" },
        status: "pending",
      })
      .select("id")
      .maybeSingle();

    // 23505 = a concurrent run or the webhook got there first; that's success.
    if (ins.error && ins.error.code !== "23505") throw ins.error;
    if (!ins.error) enqueued++;
    seen.add(m.external_id);
  }
  return enqueued;
}
