/**
 * Which accounts are drifting, across the whole book.
 *
 * WHY THIS EXISTS
 * George's understanding of an account was only reachable one customer at a
 * time. A CS lead's actual question — "who is going quiet on me?" — had no
 * surface at all, and answering it meant opening thirteen pages and holding the
 * comparison in your head.
 *
 * EVERY NUMBER HERE IS DERIVED, NONE IS JUDGED
 * Same discipline as onboarding-state.ts: the arithmetic is in code, and the
 * model is not asked to score anything. A drift figure a model produced would
 * be unauditable and would move between runs on identical data. The only thing
 * on this board the model wrote is the observation text, which is quoted from
 * the account rather than generated for the board.
 *
 * THE THRESHOLD IS THE ACCOUNT'S OWN RHYTHM, NOT A GLOBAL NUMBER
 * A weekly-connect account silent for 32 days is in trouble. A monthly account
 * silent for 32 days is on schedule. One global cutoff fires early for the
 * second and never fires for the first, which is the same reasoning that put
 * silence windows per-org in silence-sweep.ts.
 *
 * SIMNET IS THE DEMONSTRATION — KEEP THIS EXAMPLE
 * On 2026-09-04, SIMNET and Amnet Digital were both `active` and both silent
 * for about two and a half weeks. Amnet scored 5.0x and read as dark; SIMNET
 * scored 1.3x and read as healthy. Nothing separated them except their own
 * rhythms: Amnet met weekly, SIMNET fortnightly. Same silence, opposite
 * verdict, and a global threshold would have got one of them wrong whichever
 * number it picked.
 *
 * RHYTHM COMES FROM WHAT HAPPENED, NOT FROM WHAT WAS CONFIGURED
 * `cadences.frequency` was the obvious source and is unusable: 3 of 13 accounts
 * had a row at all, two of those said `ad_hoc`, and Amnet — the account most
 * obviously drifting — had none. Its "weekly connect" existed only in meeting
 * titles.
 *
 * So the rhythm is counted from distinct weeks in which contact actually
 * happened. That is better than a declared cadence rather than merely available:
 * it describes what the relationship does, not what somebody configured once
 * and stopped maintaining.
 *
 * NOT the median gap between consecutive meetings, which was the first attempt
 * and produced nonsense — accounts with several calls in one week showed a
 * median gap near zero, and Castor One scored 39x off a single interval. The
 * gap between individual calls is not a cadence.
 *
 * NOTHING HERE TRIGGERS ANYTHING
 * A reading surface, consistent with the observe-don't-act directive. No
 * buttons, no sends, no escalations. A person reads it and decides.
 */

/**
 * How long an account has been silent, as a multiple of its own rhythm.
 *
 * Read as INCLUSIVE LOWER BOUNDS: 5x or more is dark, not "strictly more than
 * 5x". The distinction is not academic — Amnet Digital computes to exactly
 * 5.0x (weekly rhythm, silent 35 days), and an exclusive bound put the one
 * account this board was commissioned to surface into `quiet`. An account five
 * times past its own rhythm is dark by any reading.
 */
export const THRESHOLDS = {
  /** Below this, the account is behaving normally for itself. */
  healthy: 1.5,
  /** Contact is stretching out but has not stopped. */
  thinning: 3,
  /** Well past its own rhythm. */
  quiet: 5,
} as const;

/**
 * Distinct weeks of contact needed before a rhythm is trustworthy.
 *
 * Two is the floor, and it is the whole reason this constant exists. With one
 * contact week there is no interval to measure, and dividing by a made-up one
 * produced Castor One at 39x — a real account with a fabricated score, which is
 * worse than a blank because it looks like a finding. An account below the floor
 * gets "not enough history" and keeps its raw silence, which is honest and still
 * visible.
 */
export const MIN_CONTACT_WEEKS = 2;

/** A week that could plausibly hold one contact, for the divide-by-tiny guard. */
const MIN_EXPECTED_WEEKS = 0.5;

export type EngagementState = "healthy" | "thinning" | "quiet" | "dark" | "insufficient";

/** What the board needs about one account. All of it already stored. */
export type EngagementFacts = {
  customerId: string;
  name: string;
  lifecycle: string;
  /** When the account started with us, for the lifecycle-elapsed label. */
  createdAt: string | null;
  /** Distinct ISO weeks in which a meeting happened. */
  contactWeeks: number;
  /** Weeks between the first and last meeting, inclusive. */
  weeksObserved: number;
  /** Most recent meeting, ISO. Null when there has never been one. */
  lastMeetingAt: string | null;
  /** Meetings in the last 30 days, and in the 30 before that. */
  meetings30: number;
  meetingsPrev30: number;
  /**
   * Inbound and outbound mail. Currently null for every account: all 37
   * messages are unattributed, so this is a known gap rather than a zero. The
   * board renders it as "no data" for exactly that reason — a zero would claim
   * the customer has never written, which is false.
   */
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** The most recent thing George noticed, for the one-line "does it matter". */
  latestObservation: { id: string; summary: string; observedAt: string } | null;
};

export type EngagementRow = {
  customerId: string;
  name: string;
  lifecycle: string;
  state: EngagementState;
  /** Days since the last meeting. Null when there has never been one. */
  silentDays: number | null;
  /** Weeks the account's own rhythm implies between contacts. */
  expectedWeeksBetween: number | null;
  /** Silence as a multiple of that. Null below the evidence floor. */
  drift: number | null;
  /** Contact thinning, steady, or picking up — from the two 30-day windows. */
  trend: "thinning" | "steady" | "warming" | "unknown";
  /** How long they have been in this lifecycle stage, in words. */
  elapsed: string | null;
  /** Why this row scored as it did, in one line a person can check. */
  because: string;
  latestObservation: EngagementFacts["latestObservation"];
  lastMeetingAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  contactWeeks: number;
  weeksObserved: number;
};

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(fromIso)) / DAY_MS);
}

/**
 * How long they have been at this stage, phrased the way a person would say it.
 *
 * Shown next to the lifecycle rather than folded into the score. Low contact in
 * onboarding week two is expected and the same pattern at month ten is a red
 * flag, but making that a hidden multiplier means a lead cannot disagree with
 * the ranking. Visible, they can.
 */
export function elapsedLabel(createdAt: string | null, now: Date): string | null {
  if (!createdAt) return null;
  const days = daysBetween(createdAt, now);
  if (days < 0) return null;
  if (days < 14) return `wk ${Math.floor(days / 7) + 1}`;
  if (days < 60) return `wk ${Math.floor(days / 7) + 1}`;
  const months = Math.floor(days / 30);
  return `month ${months}`;
}

/** Assess one account. Pure — no database, no model. */
export function assessEngagement(facts: EngagementFacts, now: Date = new Date()): EngagementRow {
  const silentDays = facts.lastMeetingAt ? daysBetween(facts.lastMeetingAt, now) : null;

  const trend: EngagementRow["trend"] =
    facts.meetings30 === 0 && facts.meetingsPrev30 === 0
      ? "unknown"
      : facts.meetings30 < facts.meetingsPrev30
        ? "thinning"
        : facts.meetings30 > facts.meetingsPrev30
          ? "warming"
          : "steady";

  const base = {
    customerId: facts.customerId,
    name: facts.name,
    lifecycle: facts.lifecycle,
    silentDays,
    trend,
    elapsed: elapsedLabel(facts.createdAt, now),
    latestObservation: facts.latestObservation,
    lastMeetingAt: facts.lastMeetingAt,
    lastInboundAt: facts.lastInboundAt,
    lastOutboundAt: facts.lastOutboundAt,
    contactWeeks: facts.contactWeeks,
    weeksObserved: facts.weeksObserved,
  };

  // Below the floor there is no rhythm to measure against. Say so rather than
  // divide by a guess — see MIN_CONTACT_WEEKS.
  if (facts.contactWeeks < MIN_CONTACT_WEEKS || silentDays === null) {
    return {
      ...base,
      state: "insufficient",
      expectedWeeksBetween: null,
      drift: null,
      because:
        facts.contactWeeks === 0 || silentDays === null
          ? "No meeting on record, so there is no rhythm to compare against."
          : `Only ${facts.contactWeeks} week of contact on record — not enough to tell a ` +
            `lapse from a normal gap. Raw silence is ${silentDays} days.`,
    };
  }

  const expectedWeeksBetween = Math.max(
    facts.weeksObserved / facts.contactWeeks,
    MIN_EXPECTED_WEEKS,
  );
  const drift = silentDays / 7 / expectedWeeksBetween;

  const state: EngagementState =
    drift >= THRESHOLDS.quiet
      ? "dark"
      : drift >= THRESHOLDS.thinning
        ? "quiet"
        : drift >= THRESHOLDS.healthy
          ? "thinning"
          : "healthy";

  const rhythm =
    expectedWeeksBetween <= 1.25
      ? "weekly"
      : expectedWeeksBetween <= 2.5
        ? "fortnightly"
        : expectedWeeksBetween <= 5
          ? "monthly"
          : `every ${Math.round(expectedWeeksBetween)} weeks`;

  return {
    ...base,
    state,
    expectedWeeksBetween: Number(expectedWeeksBetween.toFixed(1)),
    drift: Number(drift.toFixed(1)),
    because:
      `Met ${facts.contactWeeks} weeks out of ${facts.weeksObserved} — a ${rhythm} rhythm. ` +
      `Silent ${silentDays} days, which is ${drift.toFixed(1)}x that.`,
  };
}

/**
 * The board: worst first, with unscorable accounts kept separate.
 *
 * Accounts below the evidence floor sort into their own group underneath rather
 * than mixing in. On a plain days-since sort the four accounts that have never
 * met crowd the top and push real drift below the fold — they are absence of
 * evidence, not evidence of drift. They stay visible, ordered by raw silence,
 * because an onboarding account that has never met anybody is worth seeing even
 * though it cannot be scored.
 */
export function rankEngagement(
  facts: EngagementFacts[],
  now: Date = new Date(),
): { scored: EngagementRow[]; unscored: EngagementRow[] } {
  const rows = facts.map((f) => assessEngagement(f, now));
  return {
    scored: rows
      .filter((r) => r.state !== "insufficient")
      .sort((a, b) => (b.drift ?? 0) - (a.drift ?? 0)),
    unscored: rows
      .filter((r) => r.state === "insufficient")
      .sort((a, b) => (b.silentDays ?? Number.MAX_SAFE_INTEGER) - (a.silentDays ?? Number.MAX_SAFE_INTEGER)),
  };
}
