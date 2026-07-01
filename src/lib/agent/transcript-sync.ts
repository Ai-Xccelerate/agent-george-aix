import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { callScribeTool, isScribeAvailable } from "@/lib/scribe/client";
import { analyzeMeetingIntelligence } from "@/lib/agent/meeting-intelligence";

/**
 * Mirrors George's Scribe meeting transcripts into Supabase (meeting_transcripts).
 * The mirror is the source George reasons over (list_transcripts / read_transcript
 * tools) and the data the /transcripts UI renders from.
 *
 * Mechanism: list_meetings(status=completed) → for any meeting not yet stored
 * (or stored without a transcript), pull get_transcript + get_insights and
 * upsert on (org_id, external_id). Scribe auto-joins meetings George is invited
 * to, so there's nothing to dispatch — we just pull what's finished.
 *
 * Idempotent: every upsert keys on (org_id, external_id), so re-runs converge.
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
  const scribeInsights = insightsRes.ok ? insightsRes.data : null;
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

  // Hand a newly-transcribed meeting to George (recap + plan/objective update).
  // Only when there's real transcript text. Dedup on (org, source, meeting id);
  // the cron sweep picks the pending event up and runs George.
  if (text) {
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

  const list = await callScribeTool<unknown>("list_meetings", { status: "completed", limit: 100 });
  if (!list.ok) {
    result.errors.push(`list_meetings: ${list.error}`);
    return result;
  }
  const meetings = (Array.isArray(list.data) ? list.data : asObj(list.data).meetings) as
    | unknown[]
    | undefined;
  const rows = (meetings ?? []).map(asObj);
  result.meetings_seen = rows.length;
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

  for (const m of rows) {
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
