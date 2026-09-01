/**
 * The four states have to be genuinely distinguishable.
 *
 * If they are not, George writes the same email on day 7 regardless of what
 * happened, which is the failure the whole design exists to avoid. So these
 * tests hold one account at one point in the cadence and change only what
 * happened around it — the day number never moves.
 */
import { describe, expect, it } from "vitest";
import {
  assessOnboarding,
  renderOnboardingStateBlock,
  type OnboardingFacts,
} from "./onboarding-state";
import type { FirstValue } from "./tenant-process";

const NOW = new Date("2026-03-10T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

const CONFIGURED_FV: FirstValue = {
  label: "First campaign sent",
  definition: "The customer has sent a real campaign to their own list.",
  target_days: 21,
  evidence: "A named person confirms it.",
  configured: true,
};

/** Day 7 of onboarding, nothing wrong. Every test below perturbs one thing. */
function baseline(over: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    now: NOW,
    contract: { signed_at: daysAgo(7), start_date: daysAgo(7), end_date: daysAhead(358) },
    plan: { start_date: daysAgo(7), target_end_date: daysAhead(23), status: "in_progress" },
    steps: [
      { title: "Kickoff", status: "completed", due_date: daysAgo(4), ordinal: 1 },
      { title: "Provision access", status: "in_progress", due_date: daysAhead(3), ordinal: 2 },
    ],
    objectives: [],
    health: null,
    touchpoints: [
      { touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(7), replied_at: daysAgo(6) },
      { touchpoint_key: "kickoff_prep", status: "sent", sent_at: daysAgo(4), replied_at: daysAgo(4) },
    ],
    silenceDays: 5,
    firstValue: CONFIGURED_FV,
    ...over,
  };
}

describe("the same day, four different situations", () => {
  it("on track when dates hold and they are replying", () => {
    const a = assessOnboarding(baseline());
    expect(a.primary).toBe("on_track");
    expect(a.daysSinceStart).toBe(7);
  });

  it("gone quiet when the last send went unanswered past the threshold", () => {
    const a = assessOnboarding(
      baseline({
        touchpoints: [
          { touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(7), replied_at: null },
        ],
      }),
    );
    expect(a.primary).toBe("gone_quiet");
    expect(a.signals.find((s) => s.kind === "gone_quiet")?.detail).toContain("7 days");
  });

  it("blocker outstanding when something is explicitly stuck", () => {
    const a = assessOnboarding(
      baseline({
        objectives: [
          { title: "SSO certificate from IT", status: "blocked", due_date: null, responsible_side: "customer" },
        ],
      }),
    );
    expect(a.primary).toBe("blocker_outstanding");
    expect(a.signals.find((s) => s.kind === "blocker_outstanding")?.detail).toContain("SSO certificate");
  });

  it("milestone missed when a dated step slipped and they are still talking", () => {
    const a = assessOnboarding(
      baseline({
        steps: [
          { title: "Provision access", status: "in_progress", due_date: daysAgo(2), ordinal: 2 },
        ],
      }),
    );
    expect(a.primary).toBe("milestone_missed");
    expect(a.signals.find((s) => s.kind === "milestone_missed")?.detail).toContain("Provision access");
  });

  it("produces four different prompts for the same day", () => {
    // The actual property that matters: not that the labels differ, but that
    // the instruction George receives differs.
    const blocks = [
      baseline(),
      baseline({ touchpoints: [{ touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(7), replied_at: null }] }),
      baseline({ objectives: [{ title: "SSO cert", status: "blocked", due_date: null, responsible_side: "customer" }] }),
      baseline({ steps: [{ title: "Provision access", status: "in_progress", due_date: daysAgo(2), ordinal: 2 }] }),
    ].map((f) => renderOnboardingStateBlock(assessOnboarding(f)));

    expect(new Set(blocks).size).toBe(4);
    for (const b of blocks) expect(b).toContain("Day 7 of onboarding");
  });
});

describe("precedence — silence outranks everything actionable", () => {
  it("reports gone quiet even when a milestone has also slipped", () => {
    // Writing about a slipped date to someone who has not replied in a week is
    // writing into a void. Getting a response is the job.
    const a = assessOnboarding(
      baseline({
        steps: [{ title: "Provision access", status: "in_progress", due_date: daysAgo(2), ordinal: 2 }],
        touchpoints: [
          { touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(8), replied_at: null },
        ],
      }),
    );
    expect(a.primary).toBe("gone_quiet");
    // The slip is still reported — it is evidence, it just is not the subject.
    expect(a.signals.map((s) => s.kind)).toContain("milestone_missed");
  });

  it("prefers a named blocker over a bare slipped date", () => {
    const a = assessOnboarding(
      baseline({
        steps: [{ title: "Provision access", status: "blocked", due_date: daysAgo(2), ordinal: 2 }],
      }),
    );
    expect(a.primary).toBe("blocker_outstanding");
  });
});

describe("silence is measured from sends, not from drafts", () => {
  it("does not call an unapproved draft 'ignored'", () => {
    // A draft nobody approved has not been ignored — it was never sent.
    // Counting it would manufacture silence out of our own inaction.
    const a = assessOnboarding(
      baseline({
        touchpoints: [
          { touchpoint_key: "welcome", status: "awaiting_approval", sent_at: null, replied_at: null },
        ],
      }),
    );
    expect(a.primary).toBe("on_track");
    expect(a.signals.map((s) => s.kind)).not.toContain("gone_quiet");
  });

  it("does not fire one day under the threshold", () => {
    const a = assessOnboarding(
      baseline({
        touchpoints: [
          { touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(4), replied_at: null },
        ],
      }),
    );
    expect(a.primary).toBe("on_track");
  });

  it("honours a tenant's own silence window", () => {
    const facts = {
      touchpoints: [
        { touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(4), replied_at: null },
      ],
    };
    expect(assessOnboarding(baseline({ ...facts, silenceDays: 3 })).primary).toBe("gone_quiet");
    expect(assessOnboarding(baseline({ ...facts, silenceDays: 10 })).primary).toBe("on_track");
  });

  it("distinguishes never-replied from went-quiet-later", () => {
    const never = assessOnboarding(
      baseline({
        touchpoints: [{ touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(8), replied_at: null }],
      }),
    );
    const lapsed = assessOnboarding(
      baseline({
        touchpoints: [
          { touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(20), replied_at: daysAgo(19) },
          { touchpoint_key: "access_check", status: "sent", sent_at: daysAgo(8), replied_at: null },
        ],
      }),
    );
    expect(never.signals.find((s) => s.kind === "gone_quiet")?.detail).toContain("never replied");
    expect(lapsed.signals.find((s) => s.kind === "gone_quiet")?.detail).toContain("replied earlier");
  });
});

describe("first value is the claim George may not make without it", () => {
  it("refuses to let success be asserted when it is undefined", () => {
    const a = assessOnboarding(
      baseline({ firstValue: { ...CONFIGURED_FV, configured: false } }),
    );
    expect(a.firstValueKnown).toBe(false);
    const block = renderOnboardingStateBlock(a);
    expect(block).toContain("First value is undefined");
    expect(block).toMatch(/must not claim onboarding is succeeding/);
  });

  it("says nothing of the sort once the tenant has defined it", () => {
    const block = renderOnboardingStateBlock(assessOnboarding(baseline()));
    expect(block).not.toContain("First value is undefined");
  });

  it("a plausible label is not evidence it was configured", () => {
    // The seeded placeholder reads perfectly well. `configured` is the only
    // honest test, which is why the label is not consulted.
    const a = assessOnboarding(
      baseline({
        firstValue: {
          label: "First real use by the customer's own team",
          definition: "Looks entirely reasonable.",
          target_days: 21,
          evidence: "Someone says so.",
          configured: false,
        },
      }),
    );
    expect(a.firstValueKnown).toBe(false);
  });

  it("flags first value overdue only when it is actually defined", () => {
    const defined = assessOnboarding(
      baseline({
        plan: { start_date: daysAgo(30), target_end_date: daysAhead(5), status: "in_progress" },
        contract: { signed_at: daysAgo(30), start_date: daysAgo(30), end_date: daysAhead(335) },
      }),
    );
    expect(defined.signals.map((s) => s.kind)).toContain("first_value_overdue");

    const undefinedFv = assessOnboarding(
      baseline({
        plan: { start_date: daysAgo(30), target_end_date: daysAhead(5), status: "in_progress" },
        contract: { signed_at: daysAgo(30), start_date: daysAgo(30), end_date: daysAhead(335) },
        firstValue: { ...CONFIGURED_FV, configured: false },
      }),
    );
    // Cannot be overdue against a definition that does not exist.
    expect(undefinedFv.signals.map((s) => s.kind)).not.toContain("first_value_overdue");
    expect(undefinedFv.signals.map((s) => s.kind)).toContain("first_value_undefined");
  });
});

describe("it degrades honestly on thin accounts", () => {
  it("survives no plan, no contract, no touchpoints", () => {
    const a = assessOnboarding({
      now: NOW,
      contract: null,
      plan: null,
      steps: [],
      objectives: [],
      health: null,
      touchpoints: [],
      silenceDays: 5,
      firstValue: CONFIGURED_FV,
    });
    expect(a.primary).toBe("on_track");
    expect(a.daysSinceStart).toBeNull();
    expect(renderOnboardingStateBlock(a)).toContain("Target go-live: not set");
  });

  it("ignores unparseable dates rather than treating them as overdue", () => {
    const a = assessOnboarding(
      baseline({ steps: [{ title: "Odd", status: "in_progress", due_date: "not-a-date", ordinal: 1 }] }),
    );
    expect(a.primary).toBe("on_track");
  });

  it("reports a passed go-live even when every step is settled", () => {
    const a = assessOnboarding(
      baseline({
        plan: { start_date: daysAgo(60), target_end_date: daysAgo(5), status: "in_progress" },
        steps: [{ title: "Kickoff", status: "completed", due_date: daysAgo(50), ordinal: 1 }],
      }),
    );
    expect(a.primary).toBe("milestone_missed");
    expect(a.signals.map((s) => s.kind)).toContain("go_live_passed");
  });
});
