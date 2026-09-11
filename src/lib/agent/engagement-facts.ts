/**
 * Reading the board's facts out of what is already stored.
 *
 * Separate from engagement-board.ts on purpose: the arithmetic there is pure
 * and unit-tested against the real 2026-09-04 figures, and this file is the
 * only part that needs a database. Keeping the split means a change to the
 * scoring cannot be excused as "the query is different now".
 *
 * ONE ROUND TRIP FOR THE WHOLE BOOK
 * Deliberately not a subquery per account per signal. Thirteen accounts times
 * six signals is seventy-eight round trips, and the customer page already
 * taught this lesson — depth is what costs on a hosted database, not execution.
 * Four queries, joined in memory.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngagementFacts } from "./engagement-board";

/** Lifecycles that belong on an engagement board. A prospect is not drifting. */
const ON_THE_BOOK = ["onboarding", "active", "at_risk"];

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Monday of the week containing `d`, as a stable key for "a week of contact". */
function weekKey(d: Date): number {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const mondayOffset = (dow + 6) % 7;
  return t - mondayOffset * DAY_MS;
}

export async function loadEngagementFacts(
  db: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<EngagementFacts[]> {
  const cutoff60 = new Date(now.getTime() - 60 * DAY_MS).toISOString();

  const [customersRes, meetingsRes, mailRes, obsRes] = await Promise.all([
    db
      .from("customers")
      .select("id, name, lifecycle, created_at")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .in("lifecycle", ON_THE_BOOK),

    // Every meeting, not just recent ones: the rhythm needs the whole span, and
    // a 60-day window would read a long-standing monthly account as sparse.
    db
      .from("meeting_transcripts")
      .select("customer_id, started_at")
      .eq("org_id", orgId)
      .not("customer_id", "is", null)
      .not("started_at", "is", null)
      .order("started_at", { ascending: true }),

    // Bounded, because it only feeds "most recent" — and currently returns
    // nothing useful anyway: every message is unattributed. Kept live rather
    // than stubbed so the columns start working the moment attribution does.
    db
      .from("email_messages")
      .select("customer_id, direction, received_at, sent_at")
      .eq("org_id", orgId)
      .not("customer_id", "is", null)
      .gte("received_at", cutoff60),

    db
      .from("customer_observations")
      .select("id, customer_id, summary, observed_at")
      .eq("org_id", orgId)
      .order("observed_at", { ascending: false })
      .limit(200),
  ]);

  const customers = (customersRes.data ?? []) as Array<{
    id: string;
    name: string;
    lifecycle: string;
    created_at: string | null;
  }>;

  // ── meetings → contact weeks, span, last, and the two 30-day windows ──
  const weeks = new Map<string, Set<number>>();
  const last = new Map<string, string>();
  const first = new Map<string, string>();
  const m30 = new Map<string, number>();
  const mPrev30 = new Map<string, number>();
  const t30 = now.getTime() - 30 * DAY_MS;
  const t60 = now.getTime() - 60 * DAY_MS;

  for (const row of (meetingsRes.data ?? []) as Array<{
    customer_id: string;
    started_at: string;
  }>) {
    const id = row.customer_id;
    const at = Date.parse(row.started_at);
    if (!Number.isFinite(at)) continue;

    if (!weeks.has(id)) weeks.set(id, new Set());
    weeks.get(id)!.add(weekKey(new Date(at)));

    if (!first.has(id)) first.set(id, row.started_at); // ordered ascending
    last.set(id, row.started_at);

    if (at >= t30) m30.set(id, (m30.get(id) ?? 0) + 1);
    else if (at >= t60) mPrev30.set(id, (mPrev30.get(id) ?? 0) + 1);
  }

  // ── mail → most recent each way ──
  const lastIn = new Map<string, string>();
  const lastOut = new Map<string, string>();
  for (const row of (mailRes.data ?? []) as Array<{
    customer_id: string;
    direction: string | null;
    received_at: string | null;
    sent_at: string | null;
  }>) {
    const when = row.direction === "outbound" ? (row.sent_at ?? row.received_at) : row.received_at;
    if (!when) continue;
    const bucket = row.direction === "outbound" ? lastOut : lastIn;
    const prev = bucket.get(row.customer_id);
    if (!prev || Date.parse(when) > Date.parse(prev)) bucket.set(row.customer_id, when);
  }

  // ── observations → the newest per account (list is already newest-first) ──
  const newestObs = new Map<string, EngagementFacts["latestObservation"]>();
  for (const row of (obsRes.data ?? []) as Array<{
    id: string;
    customer_id: string;
    summary: string;
    observed_at: string;
  }>) {
    if (!newestObs.has(row.customer_id)) {
      newestObs.set(row.customer_id, {
        id: row.id,
        summary: row.summary,
        observedAt: row.observed_at,
      });
    }
  }

  return customers.map((c) => {
    const wk = weeks.get(c.id);
    const contactWeeks = wk?.size ?? 0;

    // Span in weeks, inclusive. One contact week is a span of one, not zero —
    // otherwise a single-meeting account divides to zero and the floor in
    // engagement-board.ts is the only thing standing between that and a
    // fabricated score.
    const f = first.get(c.id);
    const l = last.get(c.id);
    const weeksObserved =
      f && l ? Math.floor((weekKey(new Date(l)) - weekKey(new Date(f))) / WEEK_MS) + 1 : 0;

    return {
      customerId: c.id,
      name: c.name,
      lifecycle: c.lifecycle,
      createdAt: c.created_at,
      contactWeeks,
      weeksObserved,
      lastMeetingAt: l ?? null,
      meetings30: m30.get(c.id) ?? 0,
      meetingsPrev30: mPrev30.get(c.id) ?? 0,
      lastInboundAt: lastIn.get(c.id) ?? null,
      lastOutboundAt: lastOut.get(c.id) ?? null,
      latestObservation: newestObs.get(c.id) ?? null,
    };
  });
}
