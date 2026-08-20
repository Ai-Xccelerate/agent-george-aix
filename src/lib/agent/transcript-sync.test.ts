/**
 * Scribe transcript sync.
 *
 * These tests exist because this file was silently broken: it read `.meetings`
 * from a payload whose key is `items`, so every run reported
 * `meetings_seen: 0` with zero errors — indistinguishable from an account with
 * no meetings. Nothing failed, nothing logged, and `/transcripts` simply stayed
 * empty.
 *
 * So the fixtures below are copied from Scribe's actual MCP handlers
 * (Scribe-Notetaker `backend/app/routers/mcp.py`) rather than from what this
 * code hopes to receive. If Scribe changes that contract these tests break,
 * which is the entire point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Scribe client — records the calls so we can assert on the arguments sent, not
// only on the outcome. The original bug was in the arguments.
// ---------------------------------------------------------------------------
type Call = { name: string; args: Record<string, unknown> };
const calls: Call[] = [];
let meetingPages: unknown[] = [];
let transcriptReply: unknown = "[00:00:01] Jane: Hello there.";
let insightsReply: unknown = { summary: "They discussed onboarding." };

vi.mock("@/lib/scribe/client", () => ({
  isScribeAvailable: () => true,
  callScribeTool: async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args });
    if (name === "list_meetings") {
      const page = Number(args.page ?? 1);
      return { ok: true, data: meetingPages[page - 1] ?? { items: [], total: 0 } };
    }
    if (name === "get_transcript") return { ok: true, data: transcriptReply };
    if (name === "get_insights") return { ok: true, data: insightsReply };
    if (name === "get_meeting") return { ok: true, data: {} };
    return { ok: false, error: `unexpected tool ${name}` };
  },
}));

// Sonnet enrichment is a network call; assert only that we do not pay for it
// when there is nothing worth analysing.
const analyzed: string[] = [];
vi.mock("@/lib/agent/meeting-intelligence", () => ({
  analyzeMeetingIntelligence: async ({ transcriptText }: { transcriptText: string }) => {
    analyzed.push(transcriptText);
    return { sentiment: "positive", sentiment_rationale: "warm", learnings: ["x"] };
  },
}));

// ---------------------------------------------------------------------------
// Minimal Supabase stand-in. Only the four shapes this file uses.
// ---------------------------------------------------------------------------
const upserts: Record<string, unknown>[] = [];
const events: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        limit: async () => ({ data: [] }),
        maybeSingle: async () => ({ data: { id: "evt-1" }, error: null }),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: null };
        },
        insert: (row: Record<string, unknown>) => {
          if (table === "agent_events") events.push(row);
          return chain;
        },
        // `select(...).eq(...).in(...)` on meeting_transcripts is awaited
        // directly, so the chain has to be thenable.
        then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: [] }),
      };
      return chain;
    },
  }),
}));

const { syncTranscripts } = await import("./transcript-sync");

const ORG = "11111111-1111-1111-1111-111111111111";

/** A list row exactly as Scribe's _tool_list_meetings builds it. */
function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    title: "Kickoff",
    start_time: "2026-08-01T10:00:00+00:00",
    end_time: "2026-08-01T11:00:00+00:00",
    status: "completed",
    calendar_source: "google",
    has_transcript: true,
    participant_count: 2,
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  upserts.length = 0;
  events.length = 0;
  analyzed.length = 0;
  meetingPages = [{ items: [meeting()], total: 1 }];
  transcriptReply = "[00:00:01] Jane: Hello there.";
  insightsReply = { summary: "They discussed onboarding." };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the list_meetings contract", () => {
  it("reads `items`, the key Scribe actually returns", async () => {
    const r = await syncTranscripts(ORG);
    // The regression: `.meetings` gave undefined -> 0 seen, no error at all.
    expect(r.meetings_seen).toBe(1);
    expect(r.transcripts_upserted).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it("sends only page and page_size — the parameters that exist", async () => {
    await syncTranscripts(ORG);
    const list = calls.find((c) => c.name === "list_meetings")!;
    expect(Object.keys(list.args).sort()).toEqual(["page", "page_size"]);
    // `status` and `limit` were silently dropped by Scribe's args.get().
    expect(list.args).not.toHaveProperty("status");
    expect(list.args).not.toHaveProperty("limit");
  });

  it("never asks for more than the documented maximum of 20", async () => {
    await syncTranscripts(ORG);
    for (const c of calls.filter((x) => x.name === "list_meetings")) {
      expect(Number(c.args.page_size)).toBeLessThanOrEqual(20);
    }
  });

  it("pages until a short page, so meeting 21 is reachable", async () => {
    const full = Array.from({ length: 20 }, (_, i) => meeting({ id: `m-${i}` }));
    meetingPages = [
      { items: full, total: 21 },
      { items: [meeting({ id: "m-20" })], total: 21 },
    ];
    const r = await syncTranscripts(ORG);
    expect(r.meetings_seen).toBe(21);
    const pages = calls.filter((c) => c.name === "list_meetings").map((c) => c.args.page);
    expect(pages).toEqual([1, 2]);
  });

  it("stops paging instead of looping when a page repeats a full result", async () => {
    // total omitted and every page full: the page cap is the only thing that
    // ends this, which is exactly what it is for.
    const full = Array.from({ length: 20 }, (_, i) => meeting({ id: `m-${i}` }));
    meetingPages = Array.from({ length: 40 }, () => ({ items: full }));
    await syncTranscripts(ORG);
    expect(calls.filter((c) => c.name === "list_meetings").length).toBeLessThanOrEqual(15);
  });
});

describe("only completed meetings get mirrored", () => {
  it("skips a meeting still in the bot_sent stage", async () => {
    // A partial transcript stored now would freeze the row half-written.
    meetingPages = [{ items: [meeting({ status: "bot_sent" })], total: 1 }];
    const r = await syncTranscripts(ORG);
    expect(r.meetings_seen).toBe(1);
    expect(r.skipped).toBe(1);
    expect(upserts).toHaveLength(0);
  });

  it("skips one Scribe says has no transcript, without spending three calls", async () => {
    meetingPages = [{ items: [meeting({ has_transcript: false })], total: 1 }];
    await syncTranscripts(ORG);
    expect(calls.some((c) => c.name === "get_transcript")).toBe(false);
  });

  it("still attempts a meeting whose status field is absent", async () => {
    // Tolerance is deliberate: if Scribe renames `status` we would rather fetch
    // and discard than silently stop mirroring everything.
    const m = meeting();
    delete (m as Record<string, unknown>).status;
    meetingPages = [{ items: [m], total: 1 }];
    const r = await syncTranscripts(ORG);
    expect(r.transcripts_upserted).toBe(1);
  });
});

describe("Scribe's prose sentinels are not content", () => {
  it("does not store \"No transcript available for this meeting.\"", async () => {
    transcriptReply = "No transcript available for this meeting.";
    const r = await syncTranscripts(ORG);
    expect(upserts[0]?.transcript_text).toBeNull();
    expect(upserts[0]?.segment_count).toBe(0);
    // The row must stay re-syncable — this is what froze meetings permanently.
    expect(r.transcripts_enqueued).toBe(0);
  });

  it("does not pay Sonnet to analyse an error message", async () => {
    transcriptReply = "No transcript available for this meeting.";
    await syncTranscripts(ORG);
    expect(analyzed).toEqual([]);
  });

  it("treats an empty transcript the same way", async () => {
    transcriptReply = "Transcript is empty.";
    await syncTranscripts(ORG);
    expect(upserts[0]?.transcript_text).toBeNull();
  });

  it("keeps the insights sentinel out of the jsonb column", async () => {
    insightsReply = "No AI insights available. Run analysis on this meeting first.";
    await syncTranscripts(ORG);
    const insights = upserts[0]?.insights as Record<string, unknown> | null;
    // Enrichment still runs (there is a transcript), but the sentence is gone.
    expect(typeof insights === "string").toBe(false);
    expect(upserts[0]?.summary).toBeNull();
  });

  it("stores a real transcript and wakes George for it", async () => {
    const r = await syncTranscripts(ORG);
    expect(upserts[0]?.transcript_text).toContain("Jane");
    expect(r.transcripts_enqueued).toBe(1);
    expect(events[0]?.event_type).toBe("TRANSCRIPT_READY");
  });
});
