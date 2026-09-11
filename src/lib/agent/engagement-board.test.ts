/**
 * The board's arithmetic.
 *
 * Two failures would discredit this surface, and both are asserted here:
 *
 *   A fabricated score on a real account. Castor One scored 39x off a single
 *   interval in the first version. A wrong number looks like a finding, which
 *   makes it worse than a blank — somebody acts on it.
 *
 *   A global threshold. SIMNET and Amnet were both `active` and both silent
 *   about two and a half weeks; only one was drifting. Any single cutoff gets
 *   one of them wrong.
 *
 * The numbers below are the real 2026-09-04 staging figures, not invented ones,
 * so a change in the maths shows up here as a change against observed reality.
 */
import { describe, expect, it } from "vitest";
import {
  assessEngagement,
  elapsedLabel,
  rankEngagement,
  MIN_CONTACT_WEEKS,
  type EngagementFacts,
} from "./engagement-board";

const NOW = new Date("2026-09-04T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function facts(over: Partial<EngagementFacts> = {}): EngagementFacts {
  return {
    customerId: "c1",
    name: "Account",
    lifecycle: "active",
    createdAt: daysAgo(60),
    contactWeeks: 4,
    weeksObserved: 4,
    lastMeetingAt: daysAgo(5),
    meetings30: 3,
    meetingsPrev30: 3,
    lastInboundAt: null,
    lastOutboundAt: null,
    latestObservation: null,
    ...over,
  };
}

describe("the minimum-evidence floor", () => {
  it("refuses to score an account with one contact week", () => {
    // Castor One: 39 days silent, one interval, scored 39x in the first version.
    // A real account with a made-up number is the failure that discredits the
    // whole board.
    const r = assessEngagement(
      facts({ name: "Castor One", contactWeeks: 1, weeksObserved: 1, lastMeetingAt: daysAgo(39) }),
      NOW,
    );

    expect(r.state).toBe("insufficient");
    expect(r.drift).toBeNull();
    expect(r.expectedWeeksBetween).toBeNull();
  });

  it("keeps the raw silence visible on an unscorable account", () => {
    // Not scoring it must not mean hiding it. An onboarding account that has
    // met nobody for 39 days is worth seeing.
    const r = assessEngagement(
      facts({ contactWeeks: 1, weeksObserved: 1, lastMeetingAt: daysAgo(39) }),
      NOW,
    );

    expect(r.silentDays).toBe(39);
    expect(r.because).toContain("39 days");
    expect(r.because).toMatch(/not enough/i);
  });

  it("scores at the floor but not below it", () => {
    const below = assessEngagement(facts({ contactWeeks: MIN_CONTACT_WEEKS - 1 }), NOW);
    const at = assessEngagement(facts({ contactWeeks: MIN_CONTACT_WEEKS }), NOW);

    expect(below.drift).toBeNull();
    expect(at.drift).not.toBeNull();
  });

  it("says plainly when there has never been a meeting", () => {
    const r = assessEngagement(facts({ contactWeeks: 0, lastMeetingAt: null }), NOW);
    expect(r.state).toBe("insufficient");
    expect(r.silentDays).toBeNull();
    expect(r.because).toMatch(/no meeting on record/i);
  });
});

describe("the threshold is the account's own rhythm", () => {
  // The case this design exists for. Both active, both silent about two and a
  // half weeks, opposite verdicts — because their rhythms differ.
  const amnet = facts({
    name: "Amnet Digital",
    contactWeeks: 2,
    weeksObserved: 2, // weekly
    lastMeetingAt: daysAgo(35),
    meetings30: 0,
    meetingsPrev30: 3,
  });
  const simnet = facts({
    name: "SIMNET",
    contactWeeks: 2,
    weeksObserved: 4, // fortnightly
    lastMeetingAt: daysAgo(18),
    meetings30: 2,
    meetingsPrev30: 2,
  });

  it("calls the weekly account dark at 35 days", () => {
    const r = assessEngagement(amnet, NOW);
    expect(r.state).toBe("dark");
    expect(r.drift).toBeCloseTo(5.0, 1);
    expect(r.because).toContain("weekly");
  });

  it("calls the fortnightly account healthy at 18 days", () => {
    const r = assessEngagement(simnet, NOW);
    expect(r.state).toBe("healthy");
    expect(r.because).toContain("fortnightly");
  });

  it("would get one of them wrong with any single cutoff", () => {
    // Not a rhetorical point — asserted. Amnet is silent LONGER and is the one
    // in trouble, but a cutoff placed to catch it at 18-35 days would also
    // catch SIMNET, which is fine.
    const a = assessEngagement(amnet, NOW);
    const s = assessEngagement(simnet, NOW);

    expect(a.silentDays).toBeGreaterThan(s.silentDays!);
    expect(a.state).toBe("dark");
    expect(s.state).toBe("healthy");
    // And the thing that separates them is the rhythm, nothing else.
    expect(a.expectedWeeksBetween).toBeLessThan(s.expectedWeeksBetween!);
  });

  it("does not fire on a monthly account silent for 32 days", () => {
    // Rahul's own example. A month of quiet on a monthly cadence is on schedule.
    const r = assessEngagement(
      facts({ contactWeeks: 3, weeksObserved: 12, lastMeetingAt: daysAgo(32) }),
      NOW,
    );
    expect(r.state).toBe("healthy");
    expect(r.because).toContain("monthly");
  });
});

describe("Amnet stays at the top", () => {
  // The acceptance test. If the board does not surface it, the thresholds are
  // wrong — stated as such when the board was commissioned.
  const book: EngagementFacts[] = [
    facts({ customerId: "onyx", name: "Onyx", contactWeeks: 6, weeksObserved: 6, lastMeetingAt: daysAgo(4), meetings30: 7, meetingsPrev30: 7 }),
    facts({ customerId: "amnet", name: "Amnet Digital", contactWeeks: 2, weeksObserved: 2, lastMeetingAt: daysAgo(35), meetings30: 0, meetingsPrev30: 3 }),
    facts({ customerId: "pss", name: "PSS Tec", contactWeeks: 3, weeksObserved: 3, lastMeetingAt: daysAgo(24), meetings30: 1, meetingsPrev30: 2 }),
    facts({ customerId: "sugar", name: "Sugar Estate Media", contactWeeks: 4, weeksObserved: 4, lastMeetingAt: daysAgo(21), meetings30: 3, meetingsPrev30: 4 }),
    facts({ customerId: "simnet", name: "SIMNET", contactWeeks: 2, weeksObserved: 4, lastMeetingAt: daysAgo(18), meetings30: 2, meetingsPrev30: 2 }),
    facts({ customerId: "mondello", name: "Mondello Promotional", contactWeeks: 5, weeksObserved: 6, lastMeetingAt: daysAgo(0), meetings30: 9, meetingsPrev30: 2 }),
    // Unscorable — one contact week each. Must not crowd the top.
    facts({ customerId: "castor", name: "Castor One", contactWeeks: 1, weeksObserved: 1, lastMeetingAt: daysAgo(39) }),
    facts({ customerId: "stone", name: "Stonehaas Advisors", contactWeeks: 1, weeksObserved: 1, lastMeetingAt: daysAgo(19) }),
    facts({ customerId: "harbour", name: "Harbourline Freight", contactWeeks: 0, weeksObserved: 0, lastMeetingAt: null }),
  ];

  it("puts Amnet Digital first on the scored board", () => {
    const { scored } = rankEngagement(book, NOW);
    expect(scored[0].name).toBe("Amnet Digital");
    expect(scored[0].state).toBe("dark");
  });

  it("keeps the never-met accounts out of the scored list entirely", () => {
    // On a plain days-since sort these crowd the top and push real drift below
    // the fold. They are absence of evidence, not evidence of drift.
    const { scored, unscored } = rankEngagement(book, NOW);
    expect(scored.map((r) => r.name)).not.toContain("Castor One");
    expect(scored.map((r) => r.name)).not.toContain("Harbourline Freight");
    expect(unscored.map((r) => r.name)).toContain("Castor One");
  });

  it("orders the unscorable ones by raw silence, longest first", () => {
    const { unscored } = rankEngagement(book, NOW);
    expect(unscored[0].name).toBe("Harbourline Freight"); // never met at all
    expect(unscored[1].name).toBe("Castor One"); // 39 days
  });

  it("sorts the scored board worst first, all the way down", () => {
    const { scored } = rankEngagement(book, NOW);
    const drifts = scored.map((r) => r.drift ?? 0);
    expect(drifts).toEqual([...drifts].sort((a, b) => b - a));
    expect(scored[scored.length - 1].name).toBe("Mondello Promotional"); // met today
  });
});

describe("trend, from the two 30-day windows", () => {
  it("reads thinning when contact has dropped", () => {
    expect(assessEngagement(facts({ meetings30: 0, meetingsPrev30: 3 }), NOW).trend).toBe("thinning");
  });

  it("reads steady when it has not", () => {
    expect(assessEngagement(facts({ meetings30: 3, meetingsPrev30: 3 }), NOW).trend).toBe("steady");
  });

  it("reads warming when it has picked up", () => {
    expect(assessEngagement(facts({ meetings30: 9, meetingsPrev30: 2 }), NOW).trend).toBe("warming");
  });

  it("says unknown rather than steady when there is nothing in either window", () => {
    // Two zeroes are not a steady relationship. Calling that "steady" would be
    // the same class of error as scoring an account with no rhythm.
    expect(assessEngagement(facts({ meetings30: 0, meetingsPrev30: 0 }), NOW).trend).toBe("unknown");
  });
});

describe("email columns are a known gap, not a zero", () => {
  it("carries nulls through rather than inventing a date", () => {
    // All 37 messages are unattributed. A zero would claim the customer has
    // never written, which is false — the board renders these as "no data".
    const r = assessEngagement(facts(), NOW);
    expect(r.lastInboundAt).toBeNull();
    expect(r.lastOutboundAt).toBeNull();
  });

  it("does not let the missing email data change the state", () => {
    const withMail = assessEngagement(facts({ lastInboundAt: daysAgo(2) }), NOW);
    const without = assessEngagement(facts(), NOW);
    expect(withMail.state).toBe(without.state);
  });
});

describe("lifecycle elapsed is shown, not scored", () => {
  it("reads weeks early on and months later", () => {
    expect(elapsedLabel(daysAgo(3), NOW)).toBe("wk 1");
    expect(elapsedLabel(daysAgo(40), NOW)).toBe("wk 6");
    expect(elapsedLabel(daysAgo(300), NOW)).toBe("month 10");
  });

  it("does not change the drift figure", () => {
    // Week two of onboarding differs from month ten, but folding that into the
    // number invisibly means a lead cannot disagree with the ranking.
    const early = assessEngagement(facts({ createdAt: daysAgo(10) }), NOW);
    const late = assessEngagement(facts({ createdAt: daysAgo(300) }), NOW);
    expect(early.drift).toBe(late.drift);
    expect(early.elapsed).not.toBe(late.elapsed);
  });
});
