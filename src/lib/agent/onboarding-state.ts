/**
 * Where an account actually is, in a form the prompt can act on.
 *
 * THIS IS THE DIFFERENCE BETWEEN A CSM AND A SEQUENCER
 * A sequencer knows the day number. On day 7 it sends the day-7 email, whether
 * the customer replied twice, went silent after signature, or is stuck waiting
 * on a licence key. George has to write a different email in each of those
 * cases at the same point in the cadence, and he can only do that if the state
 * reaches him as a distinction rather than as raw rows.
 *
 * WHY THE STATE IS COMPUTED HERE AND NOT INFERRED IN THE PROMPT
 * Handing the model six tables and hoping it concludes "gone quiet" is how you
 * get an assistant that is right most of the time and unaccountably wrong the
 * rest. Deciding it in code makes the decision inspectable, testable, and the
 * same every time — and when it is wrong, wrong in a way that can be fixed by
 * changing a rule rather than by rewording a paragraph.
 *
 * The model still writes the email. It does not get to decide what happened.
 */
import type { FirstValue } from "./tenant-process";

/** The four situations the brief names. Everything else is evidence for one. */
export type OnboardingState =
  | "on_track"
  | "milestone_missed"
  | "gone_quiet"
  | "blocker_outstanding";

export type SignalKind =
  | "gone_quiet"
  | "blocker_outstanding"
  | "milestone_missed"
  | "first_value_overdue"
  | "first_value_undefined"
  | "health_declining"
  | "go_live_passed";

export type Signal = {
  kind: SignalKind;
  /** One line, written to be pasted into the prompt as-is. */
  detail: string;
};

export type StepFact = {
  title: string;
  status: string;
  due_date: string | null;
  ordinal: number;
};

export type ObjectiveFact = {
  title: string;
  status: string;
  due_date: string | null;
  responsible_side: string | null;
};

export type TouchpointFact = {
  touchpoint_key: string;
  status: string;
  sent_at: string | null;
  replied_at: string | null;
};

export type OnboardingFacts = {
  now: Date;
  contract: { signed_at: string | null; start_date: string | null; end_date: string | null } | null;
  plan: { start_date: string | null; target_end_date: string | null; status: string | null } | null;
  steps: StepFact[];
  objectives: ObjectiveFact[];
  health: { band: string; reason: string | null; measured_at: string } | null;
  touchpoints: TouchpointFact[];
  silenceDays: number;
  firstValue: FirstValue;
};

export type OnboardingAssessment = {
  primary: OnboardingState;
  signals: Signal[];
  daysSinceStart: number | null;
  daysToGoLive: number | null;
  /** True only when the tenant has actually defined first value. */
  firstValueKnown: boolean;
};

const DAY_MS = 86_400_000;

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** Statuses that mean a step or objective is no longer owed. */
const SETTLED = new Set(["completed", "cancelled", "achieved"]);

/**
 * Decide what is true about this account.
 *
 * Pure: takes facts, returns a judgement. No database, no clock of its own —
 * `now` is passed in so the tests can put the account at any point in its life
 * without waiting.
 */
export function assessOnboarding(facts: OnboardingFacts): OnboardingAssessment {
  const { now } = facts;
  const signals: Signal[] = [];

  const start =
    parseDate(facts.plan?.start_date) ??
    parseDate(facts.contract?.signed_at) ??
    parseDate(facts.contract?.start_date);
  const goLive = parseDate(facts.plan?.target_end_date);
  const daysSinceStart = start ? daysBetween(start, now) : null;
  const daysToGoLive = goLive ? daysBetween(now, goLive) : null;

  // ---- silence ----------------------------------------------------------
  // The most recent thing George sent, and whether anyone answered it. Only
  // sends count: a draft nobody approved has not been ignored, it has not been
  // sent, and treating those the same would manufacture silence out of our own
  // inaction.
  const sent = facts.touchpoints
    .filter((t) => t.sent_at && (t.status === "sent" || t.status === "silent" || t.replied_at))
    .sort((a, b) => Date.parse(b.sent_at!) - Date.parse(a.sent_at!));
  const lastSent = sent[0] ?? null;
  const anyReply = facts.touchpoints.some((t) => t.replied_at);

  let quietDays: number | null = null;
  if (lastSent && !lastSent.replied_at) {
    const at = parseDate(lastSent.sent_at);
    if (at) quietDays = daysBetween(at, now);
  }
  const goneQuiet = quietDays !== null && quietDays >= facts.silenceDays;
  if (goneQuiet) {
    const unanswered = sent.filter((t) => !t.replied_at).length;
    signals.push({
      kind: "gone_quiet",
      detail:
        `No reply for ${quietDays} days (threshold ${facts.silenceDays}). ` +
        `${unanswered} unanswered message${unanswered === 1 ? "" : "s"}; ` +
        `${anyReply ? "they have replied earlier in onboarding" : "they have never replied"}.`,
    });
  }

  // ---- explicit blockers -------------------------------------------------
  const blockedSteps = facts.steps.filter((s) => s.status === "blocked");
  const blockedObjectives = facts.objectives.filter((o) => o.status === "blocked");
  if (blockedSteps.length || blockedObjectives.length) {
    const named = [
      ...blockedSteps.map((s) => s.title),
      ...blockedObjectives.map((o) => o.title),
    ].slice(0, 4);
    signals.push({
      kind: "blocker_outstanding",
      detail: `Blocked and unresolved: ${named.join("; ")}.`,
    });
  }

  // ---- missed dates ------------------------------------------------------
  const overdueSteps = facts.steps.filter((s) => {
    const due = parseDate(s.due_date);
    return due !== null && due < now && !SETTLED.has(s.status);
  });
  const overdueObjectives = facts.objectives.filter((o) => {
    const due = parseDate(o.due_date);
    return due !== null && due < now && !SETTLED.has(o.status);
  });
  if (overdueSteps.length || overdueObjectives.length) {
    const named = [
      ...overdueSteps.map((s) => `${s.title} (due ${s.due_date})`),
      ...overdueObjectives.map((o) => `${o.title} (due ${o.due_date})`),
    ].slice(0, 4);
    signals.push({
      kind: "milestone_missed",
      detail: `Past due: ${named.join("; ")}.`,
    });
  }

  if (goLive && goLive < now && facts.plan?.status !== "completed") {
    signals.push({
      kind: "go_live_passed",
      detail: `Target go-live was ${facts.plan?.target_end_date} (${Math.abs(daysToGoLive ?? 0)} days ago) and onboarding is not closed.`,
    });
  }

  // ---- first value -------------------------------------------------------
  // The whole reason the field exists: without it, "onboarding is going well"
  // can only mean "emails went out", which is not a claim worth making.
  const firstValueKnown = facts.firstValue.configured === true;
  if (!firstValueKnown) {
    signals.push({
      kind: "first_value_undefined",
      detail:
        "This tenant has NOT defined what first value means — the seeded placeholder is " +
        "still in place. Progress can be described, but success cannot be asserted.",
    });
  } else if (start && facts.firstValue.target_days > 0) {
    const dueBy = new Date(start.getTime() + facts.firstValue.target_days * DAY_MS);
    if (dueBy < now) {
      signals.push({
        kind: "first_value_overdue",
        detail:
          `First value ("${facts.firstValue.label}") was targeted for day ` +
          `${facts.firstValue.target_days}; it is day ${daysSinceStart} and it has not been confirmed.`,
      });
    }
  }

  // ---- health ------------------------------------------------------------
  if (facts.health && (facts.health.band === "red" || facts.health.band === "yellow")) {
    signals.push({
      kind: "health_declining",
      detail:
        `Health is ${facts.health.band} as of ${facts.health.measured_at}` +
        (facts.health.reason ? ` — ${facts.health.reason}.` : "."),
    });
  }

  // ---- which one drives the email ---------------------------------------
  //
  // Precedence, and the reasoning, because this ordering IS the behaviour:
  //
  //   1. gone_quiet          — if nobody is answering, nothing else you write
  //                            matters. The job stops being "advance the plan"
  //                            and becomes "get a response", possibly from a
  //                            different person. Addressing a missed milestone
  //                            at someone who has not replied in nine days is
  //                            writing into a void.
  //   2. blocker_outstanding — a live conversation with a named obstacle. The
  //                            most actionable state there is: there is one
  //                            concrete thing to move.
  //   3. milestone_missed    — a date slipped and they are still talking. Worth
  //                            naming, but it is a slip, not a stall.
  //   4. on_track            — the only state where the touchpoint's own
  //                            purpose is the right subject of the email.
  //
  // Ordered rather than scored on purpose: a weighting would be tuneable and
  // therefore arguable, and this needs to be predictable more than it needs to
  // be clever.
  const primary: OnboardingState = goneQuiet
    ? "gone_quiet"
    : signals.some((s) => s.kind === "blocker_outstanding")
      ? "blocker_outstanding"
      : signals.some((s) => s.kind === "milestone_missed" || s.kind === "go_live_passed")
        ? "milestone_missed"
        : "on_track";

  return { primary, signals, daysSinceStart, daysToGoLive, firstValueKnown };
}

const STATE_GUIDANCE: Record<OnboardingState, string> = {
  on_track:
    "Write to the touchpoint's own purpose. Do not manufacture concern, and do not " +
    "ask for a status update the account state already answers.",
  milestone_missed:
    "Name the specific thing that slipped and what it blocks. Do not restate the whole " +
    "plan, do not open with an apology, and do not ask them to 'confirm status' — ask for " +
    "the one thing that unblocks the slip.",
  gone_quiet:
    "They are not replying. Make it easier to answer than to ignore: one short question, " +
    "no recap, no new work. Consider whether a different named contact should be asked " +
    "instead — and if the right person is not on the account record, raise a decision " +
    "rather than guessing at one.",
  blocker_outstanding:
    "Work the blocker and nothing else. Say what is stuck, who you believe owns it, and " +
    "what you need to move it. Do not advance to the next stage's business.",
};

/**
 * Render the assessment for the prompt.
 *
 * Written as flat declarative lines rather than prose: the model is being told
 * what is true, not being asked to interpret a narrative.
 */
export function renderOnboardingStateBlock(a: OnboardingAssessment): string {
  const lines: string[] = [
    "\n\n# Where this account actually is",
    "",
    `- State: **${a.primary}**`,
    a.daysSinceStart !== null ? `- Day ${a.daysSinceStart} of onboarding` : null,
    a.daysToGoLive !== null
      ? `- Target go-live: ${a.daysToGoLive >= 0 ? `in ${a.daysToGoLive} days` : `${Math.abs(a.daysToGoLive)} days ago`}`
      : "- Target go-live: not set",
  ].filter(Boolean) as string[];

  if (a.signals.length) {
    lines.push("", "What is true right now:");
    for (const s of a.signals) lines.push(`- ${s.detail}`);
  }

  lines.push("", `How to write given the state: ${STATE_GUIDANCE[a.primary]}`);

  if (!a.firstValueKnown) {
    lines.push(
      "",
      "**First value is undefined for this tenant.** You may report what has happened, " +
        "but you must not claim onboarding is succeeding, on track to succeed, or complete — " +
        "there is no definition to measure that against. If asked whether it is going well, " +
        "say what has and has not happened and that first value has not been defined.",
    );
  }

  return lines.join("\n");
}
