import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callScribeTool, isScribeAvailable } from "@/lib/scribe/client";
import { analyzeMeetingIntelligence } from "@/lib/agent/meeting-intelligence";

/**
 * Mirrors George's Scribe meeting transcripts into Supabase (meeting_transcripts).
 * The mirror is the source George reasons over (list_transcripts / read_transcript
 * tools) and the data the /transcripts UI renders from.
 *
 * Mechanism: page through list_meetings → keep the completed ones → for any
 * meeting not yet stored (or stored without a transcript), pull get_transcript
 * + get_insights and upsert on (org_id, external_id). Scribe auto-joins meetings
 * George is invited to, so there's nothing to dispatch — we just pull what's
 * finished.
 *
 * Idempotent: every upsert keys on (org_id, external_id), so re-runs converge.
 *
 * THE CONTRACT THIS FILE DEPENDS ON, AND HOW IT BIT US
 * Scribe's MCP tools (Scribe-Notetaker backend/app/routers/mcp.py) are typed
 * loosely and fail quietly, so every assumption below is deliberate:
 *
 *   list_meetings takes ONLY page + page_size (max 20). Unknown arguments are
 *   dropped by args.get(), not rejected — an earlier version of this file sent
 *   {status, limit} and silently received the 10 newest meetings, unfiltered.
 *
 *   list_meetings returns {items, total, page, page_size}. Reading the wrong key
 *   yields undefined, which looks exactly like an empty mailbox: this file
 *   reported meetings_seen: 0 with no error for as long as it was wrong.
 *
 *   get_transcript / get_insights answer with PROSE when there is nothing to
 *   return ("No transcript available for this meeting."). Those strings are
 *   truthy and would be stored as content — see isEmptyReply.
 */

export type TranscriptSyncResult = {
  meetings_seen: number;
  transcripts_upserted: number;
  /** Newly-transcribed meetings handed to George to act on. */
  transcripts_enqueued: number;
  skipped: number;
  errors: string[];
};

type Admin = ReturnType<typeof createSupabaseAdmin>;
type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}
/** First present value across candidate keys. */
function pick(o: Json, keys: string[]): unknown {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}
function isoOrNull(v: unknown): string | null {
  const s = typeof v === "string" || typeof v === "number" ? v : null;
  if (s == null) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Scribe answers with a human sentence rather than an error or null when a
 * meeting has no transcript or no analysis yet.
 *
 * Left undetected, "No transcript available for this meeting." is a truthy
 * string: it passes `if (text)`, gets written to transcript_text, and on the
 * next run marks the meeting as already-mirrored — so the real transcript,
 * which usually lands a few minutes later, is never fetched. It also burned a
 * Sonnet call analysing a 40-character error message.
 */
const SCRIBE_EMPTY_REPLIES = [
  "no transcript available",
  "transcript is empty",
  "no ai insights available",
  "no chat messages",
];

function isEmptyReply(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return SCRIBE_EMPTY_REPLIES.some((prefix) => s.startsWith(prefix));
}

/**
 * Meetings actually fetched per run.
 *
 * The first sweep of a real workspace had ~490 to pull, each costing three
 * Scribe calls plus a model call on up to 40k characters. Serially that ran for
 * over half an hour and held the single cron lock the whole time, so every other
 * job — mailbox mirror, objectives, health checks — was skipped tick after tick.
 * That is what happened on the first live run.
 *
 * Bounding the batch keeps each tick short. Progress is monotonic because
 * already-mirrored meetings are skipped, so successive runs work through the
 * backlog until it clears.
 */
const SCRIBE_MAX_PER_RUN = 25;

/**
 * How recent a meeting must be for George to act on it, and how many may be
 * handed over in one run. Same shape and same numbers as the inbound-mail path
 * (mailbox-sync.ts), which has always had this and never had the problem.
 *
 * MIRRORING A MEETING AND CREATING WORK ARE DIFFERENT ACTS. Until 2026-08-20
 * this file conflated them: every mirrored meeting with a transcript enqueued a
 * TRANSCRIPT_READY event regardless of when the meeting happened. The first sync
 * of a real workspace therefore produced ~490 tasks, George worked through them,
 * and colleagues received recaps of meetings from three days earlier.
 *
 * The mirror still takes everything — the /transcripts UI and George's
 * list_transcripts tool want full history. Only the decision to ACT is gated.
 */
const ENQUEUE_WINDOW_MS = 6 * 60 * 60_000;
const ENQUEUE_MAX_PER_RUN = 25;

/**
 * Parse a Scribe timestamp.
 *
 * Scribe's MCP emits naive datetimes — "2026-08-20T21:30:00", no offset — while
 * its REST API documents them with one. JavaScript reads a naive datetime as
 * LOCAL time, so the same string means different instants on different hosts, and
 * a few hours of drift matters at a 6h boundary. The underlying values are UTC,
 * so say so explicitly rather than depending on the container's timezone.
 */
function parseScribeTime(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const hasZone = /([+-]\d{2}:?\d{2}|Z)$/.test(value);
  const t = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Is this meeting recent enough to hand to George?
 *
 * Judged on the meeting's own end time, falling back to its start time.
 *
 * WHY FALL BACK RATHER THAN SKIP: 37 of the 500 completed-with-transcript
 * meetings in the live workspace have no end_time at all — manual bot dispatches
 * and ad-hoc calls that were never scheduled — and one of them was from
 * yesterday. Skipping on a null end date would silently ignore those forever,
 * including genuinely fresh ones. start_time is populated on 100% of records, and
 * because a meeting starts before it ends, testing the start is STRICTER than
 * testing the end: the fallback can never admit a meeting the end date would have
 * rejected. If both are missing we skip, because then there is nothing to judge.
 */
function isRecentEnoughToAct(m: Json): boolean {
  const ended = parseScribeTime(pick(m, ["ended_at", "end_time", "endTime", "end"]));
  const started = parseScribeTime(pick(m, ["started_at", "start_time", "startTime", "start"]));
  const when = ended ?? started;
  if (when === null) return false;
  return Date.now() - when <= ENQUEUE_WINDOW_MS;
}

/** Scribe's documented maximum; asking for more is silently clamped to it. */
const SCRIBE_PAGE_SIZE = 20;
/**
 * Bound, not a target — stops a paging bug from looping forever.
 *
 * Sized against reality: the AIX workspace already holds ~680 meetings (34
 * pages), so a small cap would silently mirror only the newest slice. Paging is
 * cheap — one list call each, and the expensive per-meeting fetches are gated
 * separately by has_transcript and by what is already mirrored.
 *
 * Deliberately NOT an early exit on the first fully-mirrored page: ordering is
 * by start time, but a transcript can land days after its meeting, so
 * done-ness is not monotonic down the list. Stopping at the first complete
 * page would strand exactly those late arrivals.
 */
const SCRIBE_MAX_PAGES = 60;

/**
 * One page of list_meetings. `items` is the real key; the others are tolerated
 * so a rename upstream degrades instead of silently returning nothing.
 */
function readMeetingPage(raw: unknown): { items: Json[]; total: number | null } {
  if (Array.isArray(raw)) return { items: raw.map(asObj), total: null };
  const o = asObj(raw);
  const items = pick(o, ["items", "meetings", "results", "data"]);
  return {
    items: Array.isArray(items) ? items.map(asObj) : [],
    total: typeof o.total === "number" ? o.total : null,
  };
}

/**
 * Scribe's status lifecycle is pending → bot_sent → completed / failed
 * (Scribe-Notetaker backend/database.py). Only a completed meeting has a final
 * transcript worth mirroring — a bot_sent one may expose a partial transcript,
 * and since a stored transcript marks the row done forever, mirroring a partial
 * would freeze it half-written.
 *
 * There is no server-side status filter, so this is enforced here.
 */
function isMirrorable(m: Json): boolean {
  // Scribe already told us there is nothing to fetch; skip three round trips.
  if (pick(m, ["has_transcript"]) === false) return false;
  const status = str(pick(m, ["status"]))?.toLowerCase();
  // A MISSING status is allowed through on purpose. If Scribe renames the field
  // we would rather attempt the fetch — and discard the sentinel — than silently
  // stop mirroring everything, which is the failure mode that hid the last bug.
  if (!status) return true;
  return status === "completed";
}

function meetingId(m: Json): string | null {
  return str(pick(m, ["id", "meeting_id", "uuid"]));
}

/** Attendee emails, lowercased — for resolving the meeting to a customer. */
function attendeeEmails(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  const out: string[] = [];
  for (const a of attendees) {
    if (typeof a === "string" && a.includes("@")) out.push(a.toLowerCase());
    else {
      const email = str(pick(asObj(a), ["email", "address", "emailAddress"]));
      if (email?.includes("@")) out.push(email.toLowerCase());
    }
  }
  return [...new Set(out)];
}

/** Flatten Scribe transcript segments into speaker-labelled text. */
function flattenTranscript(raw: unknown): { text: string | null; count: number } {
  // Must come first: the sentinel is a plain string and would otherwise be
  // adopted verbatim as the transcript by the `typeof raw === "string"` branch.
  if (isEmptyReply(raw)) return { text: null, count: 0 };
  const segments = Array.isArray(raw)
    ? raw
    : Array.isArray(asObj(raw).segments)
      ? (asObj(raw).segments as unknown[])
      : [];
  if (segments.length === 0) {
    const t = str(asObj(raw).text) ?? (typeof raw === "string" ? raw : null);
    return { text: t, count: t ? 1 : 0 };
  }
  const lines: string[] = [];
  for (const seg of segments) {
    const s = asObj(seg);
    const speaker = str(pick(s, ["speaker", "speaker_name", "speakerName", "speaker_label"]));
    const text = str(pick(s, ["text", "content", "transcript"]));
    if (!text) continue;
    lines.push(speaker ? `${speaker}: ${text}` : text);
  }
  return { text: lines.length ? lines.join("\n") : null, count: lines.length };
}

function summaryFromInsights(insights: unknown): string | null {
  const o = asObj(insights);
  return str(pick(o, ["summary", "overview", "tldr", "tl_dr", "abstract"]));
}

async function resolveCustomerId(
  admin: Admin,
  orgId: string,
  emails: string[],
): Promise<string | null> {
  if (emails.length === 0) return null;
  const { data } = await admin
    .from("contacts")
    .select("customer_id, email")
    .eq("org_id", orgId)
    .in("email", emails)
    .limit(1);
  const row = (data ?? [])[0] as { customer_id?: string } | undefined;
  return row?.customer_id ?? null;
}

async function syncOneMeeting(
  admin: Admin,
  orgId: string,
  m: Json,
  result: TranscriptSyncResult,
  existingWithTranscript: Set<string>,
): Promise<void> {
  const extId = meetingId(m);
  if (!extId) return;

  // Already mirrored with a transcript — nothing new to pull.
  if (existingWithTranscript.has(extId)) {
    result.skipped++;
    return;
  }

  const [transcriptRes, insightsRes, detailRes] = await Promise.all([
    callScribeTool<unknown>("get_transcript", { meeting_id: extId }),
    callScribeTool<unknown>("get_insights", { meeting_id: extId }),
    callScribeTool<unknown>("get_meeting", { meeting_id: extId }),
  ]);

  const detail = detailRes.ok ? asObj(detailRes.data) : {};
  // Prefer the richer get_meeting payload, fall back to the list row.
  const src: Json = { ...m, ...detail };

  const { text, count } = transcriptRes.ok
    ? flattenTranscript(transcriptRes.data)
    : { text: null, count: 0 };
  const scribeInsights =
    insightsRes.ok && !isEmptyReply(insightsRes.data) ? insightsRes.data : null;
  const summary = summaryFromInsights(scribeInsights);

  // Enrich with George-derived sentiment + learnings (Scribe doesn't provide
  // these). Best-effort — merged into the insights jsonb when it succeeds.
  let insights: unknown = scribeInsights;
  if (text) {
    const intel = await analyzeMeetingIntelligence({ transcriptText: text, summary });
    if (intel) {
      const base =
        scribeInsights && typeof scribeInsights === "object" ? (scribeInsights as Json) : {};
      insights = {
        ...base,
        sentiment: intel.sentiment,
        sentiment_rationale: intel.sentiment_rationale,
        learnings: intel.learnings,
      };
    }
  }

  const attendees = pick(src, ["attendees", "participants"]) ?? [];
  const emails = attendeeEmails(attendees);
  const customerId = await resolveCustomerId(admin, orgId, emails);

  const startedAt = isoOrNull(pick(src, ["started_at", "start_time", "startTime", "start", "created_at"]));
  const endedAt = isoOrNull(pick(src, ["ended_at", "end_time", "endTime", "end"]));
  const durationMin =
    startedAt && endedAt
      ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000))
      : (pick(src, ["duration_min", "duration_minutes"]) as number | undefined) ?? null;

  const { error } = await admin.from("meeting_transcripts").upsert(
    {
      org_id: orgId,
      external_id: extId,
      title: str(pick(src, ["title", "name", "subject", "topic"])),
      status: str(pick(src, ["status"])) ?? "completed",
      started_at: startedAt,
      ended_at: endedAt,
      duration_min: durationMin,
      attendees: Array.isArray(attendees) ? attendees : [],
      transcript_text: text,
      segment_count: count,
      insights: insights ?? null,
      summary,
      customer_id: customerId,
      meeting_url: str(pick(src, ["meeting_url", "url", "join_url", "joinUrl"])),
      raw: { meeting: src, transcript_ok: transcriptRes.ok, insights_ok: insightsRes.ok },
      synced_at: new Date().toISOString(),
    },
    { onConflict: "org_id,external_id" },
  );
  if (error) {
    result.errors.push(`meeting ${extId}: ${error.message}`);
    return;
  }
  result.transcripts_upserted++;

  // Hand a newly-transcribed meeting to George (plan/objective update + a recap
  // draft for the PM). Dedup on (org, source, meeting id); the cron sweep picks
  // the pending event up and runs George.
  //
  // Three conditions, all necessary:
  //   text                     — nothing to act on without a transcript
  //   isRecentEnoughToAct(src) — a backfill must mirror silently, not create work
  //   under the per-run cap    — one run must not hand over an unbounded queue
  const actionable =
    !!text &&
    isRecentEnoughToAct(src) &&
    result.transcripts_enqueued < ENQUEUE_MAX_PER_RUN;
  if (actionable) {
    const ins = await admin
      .from("agent_events")
      .insert({
        org_id: orgId,
        source: "transcript_sync",
        source_event_id: extId,
        event_type: "TRANSCRIPT_READY",
        payload: { data: { id: extId }, source: "transcript_sync" },
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (ins.error && ins.error.code !== "23505") {
      result.errors.push(`enqueue ${extId}: ${ins.error.message}`);
    } else if (!ins.error) {
      result.transcripts_enqueued++;
    }
  }
}

export async function syncTranscripts(orgId: string): Promise<TranscriptSyncResult> {
  const result: TranscriptSyncResult = {
    meetings_seen: 0,
    transcripts_upserted: 0,
    transcripts_enqueued: 0,
    skipped: 0,
    errors: [],
  };
  if (!isScribeAvailable()) {
    result.errors.push("Scribe is not configured.");
    return result;
  }

  const admin = createSupabaseAdmin();

  // Page rather than asking for one big list: page_size is capped at 20, and an
  // over-large request is clamped silently rather than refused.
  const seen: Json[] = [];
  for (let page = 1; page <= SCRIBE_MAX_PAGES; page++) {
    const list = await callScribeTool<unknown>("list_meetings", {
      page,
      page_size: SCRIBE_PAGE_SIZE,
    });
    if (!list.ok) {
      result.errors.push(`list_meetings page ${page}: ${list.error}`);
      break;
    }
    const { items, total } = readMeetingPage(list.data);
    seen.push(...items);
    // Short page means the end. `total` is a second stop condition for the case
    // where a full last page happens to land exactly on the boundary.
    if (items.length < SCRIBE_PAGE_SIZE) break;
    if (total !== null && seen.length >= total) break;

    // Reached the cap with more to fetch: say so. A truncated sweep that looks
    // identical to a complete one is the failure mode this file already had.
    if (page === SCRIBE_MAX_PAGES) {
      result.errors.push(
        `list_meetings: stopped at the ${SCRIBE_MAX_PAGES}-page cap after ${seen.length} meetings` +
          (total !== null ? ` of ${total}` : "") +
          " — raise SCRIBE_MAX_PAGES to mirror the rest.",
      );
    }
  }

  result.meetings_seen = seen.length;
  const rows = seen.filter(isMirrorable);
  // Counted as skipped so a run that saw meetings but mirrored none is legible
  // rather than looking like an empty account.
  result.skipped += seen.length - rows.length;
  if (rows.length === 0) return result;

  // Which meetings do we already have a transcript for? Skip those.
  const ids = rows.map(meetingId).filter((x): x is string => !!x);
  const existingWithTranscript = new Set<string>();
  if (ids.length) {
    const { data: have } = await admin
      .from("meeting_transcripts")
      .select("external_id, transcript_text")
      .eq("org_id", orgId)
      .in("external_id", ids);
    for (const r of (have ?? []) as Array<{ external_id: string; transcript_text: string | null }>) {
      if (r.transcript_text) existingWithTranscript.add(r.external_id);
    }
  }

  // Bound the batch: already-mirrored meetings are cheap to recognise here, so
  // spend the run's budget on ones that still need fetching.
  const pending = rows.filter((m) => {
    const id = meetingId(m);
    return id !== null && !existingWithTranscript.has(id);
  });
  result.skipped += rows.length - pending.length;

  const batch = pending.slice(0, SCRIBE_MAX_PER_RUN);
  if (pending.length > batch.length) {
    // Progress, not a problem — but say it, so a partial run is never mistaken
    // for a finished one.
    console.log(
      `[transcript sync] ${orgId}: mirroring ${batch.length} of ${pending.length} outstanding meetings this run`,
    );
  }

  for (const m of batch) {
    try {
      await syncOneMeeting(admin, orgId, m, result, existingWithTranscript);
    } catch (err) {
      result.errors.push(
        `meeting ${meetingId(m) ?? "?"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
