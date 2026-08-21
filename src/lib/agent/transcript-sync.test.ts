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

/** Minutes ago, as a naive UTC string — the shape Scribe's MCP actually emits. */
function agoNaive(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d+Z$/, "");
}

/**
 * A list row exactly as Scribe's _tool_list_meetings builds it.
 *
 * Fresh by default: the enqueue gate is judged on the meeting's own date, so a
 * fixture with a hardcoded past date would silently stop enqueueing as the
 * calendar moved and every enqueue assertion would rot into a false pass.
 */
function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    title: "Kickoff",
    start_time: agoNaive(90),
    end_time: agoNaive(30),
    status: "completed",
    calendar_source: "google",
    has_transcript: true,
    participant_count: 2,
    ...over,
  };
}

/** Same, but ended days ago — the shape a first-time backfill is made of. */
function oldMeeting(over: Record<string, unknown> = {}) {
  return meeting({
    start_time: agoNaive(60 * 24 * 3 + 60),
    end_time: agoNaive(60 * 24 * 3),
    ...over,
  });
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

  it("stops at the cap, and says so rather than looking complete", async () => {
    // total omitted and every page full: the page cap is the only thing that
    // ends this, which is exactly what it is for.
    const full = Array.from({ length: 20 }, (_, i) => meeting({ id: `m-${i}` }));
    meetingPages = Array.from({ length: 90 }, () => ({ items: full }));
    const r = await syncTranscripts(ORG);
    expect(calls.filter((c) => c.name === "list_meetings").length).toBeLessThanOrEqual(60);
    // A truncated sweep that reads as a complete one is the whole failure mode
    // this file suffered from, so the cap must announce itself.
    expect(r.errors.join(" ")).toMatch(/cap/i);
  });
});

describe("one run does a bounded amount of work", () => {
  it("stops after the per-run batch instead of holding the cron lock", async () => {
    // The first live run had ~490 meetings to fetch, each costing three Scribe
    // calls plus a model call. Serially that ran over half an hour and starved
    // every other cron job behind the single tick lock.
    const many = Array.from({ length: 20 }, (_, i) => meeting({ id: `m-${i}` }));
    meetingPages = [
      { items: many, total: 40 },
      { items: Array.from({ length: 20 }, (_, i) => meeting({ id: `n-${i}` })), total: 40 },
    ];
    const r = await syncTranscripts(ORG);

    expect(r.meetings_seen).toBe(40);
    // Listing is cheap and still complete; only the fetching is bounded.
    expect(r.transcripts_upserted).toBeLessThanOrEqual(25);
    expect(calls.filter((c) => c.name === "get_transcript").length).toBe(
      r.transcripts_upserted,
    );
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

/**
 * THE ACCEPTANCE CRITERION for the 2026-08-20 incident.
 *
 * Mirroring a meeting and creating work are different acts. Before this gate,
 * every mirrored meeting with a transcript enqueued a TRANSCRIPT_READY event
 * regardless of when the meeting happened — so the first sync of a real
 * workspace produced ~490 tasks and George emailed recaps of three-day-old
 * standups.
 */
describe("a backfill of old meetings creates no work", () => {
  it("mirrors 680 old meetings and enqueues ZERO tasks", async () => {
    // The real workspace: 680 meetings, 34 pages, all historic.
    const pages = [];
    for (let p = 0; p < 34; p++) {
      const size = p === 33 ? 15 : 20;
      pages.push({
        items: Array.from({ length: size }, (_, i) => oldMeeting({ id: `old-${p}-${i}` })),
        total: 675,
      });
    }
    meetingPages = pages;

    const r = await syncTranscripts(ORG);

    // The mirror still takes everything — /transcripts and list_transcripts want
    // the history. Only the decision to ACT is gated.
    expect(r.meetings_seen).toBe(675);
    expect(r.transcripts_upserted).toBeGreaterThan(0);

    // The whole point:
    expect(r.transcripts_enqueued).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("still enqueues a meeting that ended half an hour ago", async () => {
    meetingPages = [{ items: [meeting()], total: 1 }];
    const r = await syncTranscripts(ORG);
    expect(r.transcripts_enqueued).toBe(1);
    expect(events[0]?.event_type).toBe("TRANSCRIPT_READY");
  });

  it("does not enqueue a meeting that ended three days ago", async () => {
    meetingPages = [{ items: [oldMeeting()], total: 1 }];
    const r = await syncTranscripts(ORG);
    // Still mirrored, just not actioned.
    expect(r.transcripts_upserted).toBe(1);
    expect(r.transcripts_enqueued).toBe(0);
  });

  it("caps how much work one run may hand over", async () => {
    // 40 genuinely fresh meetings must not become 40 tasks in one tick.
    meetingPages = [
      { items: Array.from({ length: 20 }, (_, i) => meeting({ id: `f-${i}` })), total: 40 },
      { items: Array.from({ length: 20 }, (_, i) => meeting({ id: `g-${i}` })), total: 40 },
    ];
    const r = await syncTranscripts(ORG);
    expect(r.transcripts_enqueued).toBeLessThanOrEqual(25);
  });
});

describe("judging a meeting's date", () => {
  it("treats Scribe's naive timestamps as UTC, not as local time", async () => {
    // Scribe's MCP emits "2026-08-20T21:30:00" with no offset. JavaScript reads
    // that as LOCAL time, so on a non-UTC host the same string means a different
    // instant — hours of drift, against a 6h window.
    const m = meeting();
    delete (m as Record<string, unknown>).end_time;
    (m as Record<string, unknown>).start_time = agoNaive(10); // naive, no Z
    meetingPages = [{ items: [m], total: 1 }];

    const r = await syncTranscripts(ORG);
    expect(r.transcripts_enqueued).toBe(1);
  });

  it("falls back to start_time when end_time is absent", async () => {
    // 37 of 500 completed-with-transcript meetings in the live workspace have no
    // end_time — manual dispatches and ad-hoc calls. Skipping them outright would
    // silently ignore fresh meetings forever.
    const m = meeting();
    delete (m as Record<string, unknown>).end_time;
    meetingPages = [{ items: [m], total: 1 }];

    expect((await syncTranscripts(ORG)).transcripts_enqueued).toBe(1);
  });

  it("does not act when the meeting has no date at all", async () => {
    // Nothing to judge, so do not guess.
    const m = meeting();
    delete (m as Record<string, unknown>).end_time;
    delete (m as Record<string, unknown>).start_time;
    meetingPages = [{ items: [m], total: 1 }];

    expect((await syncTranscripts(ORG)).transcripts_enqueued).toBe(0);
  });

  it("uses start_time as a stricter test than end_time, never a looser one", async () => {
    // A long meeting that STARTED outside the window but ended inside it: the
    // fallback is only reached when end_time is missing, so the fallback can never
    // admit something the end date would have rejected.
    const m = meeting({ start_time: agoNaive(60 * 24), end_time: agoNaive(10) });
    meetingPages = [{ items: [m], total: 1 }];
    expect((await syncTranscripts(ORG)).transcripts_enqueued).toBe(1);

    const n = meeting({ id: "n-1", start_time: agoNaive(60 * 24) });
    delete (n as Record<string, unknown>).end_time;
    meetingPages = [{ items: [n], total: 1 }];
    expect((await syncTranscripts(ORG)).transcripts_enqueued).toBe(0);
  });
});
