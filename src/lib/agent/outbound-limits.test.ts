/**
 * These limits are the direct answer to 2026-08-20, when George sent 16 recap
 * emails to 14 colleagues in 90 minutes.
 *
 * The important thing to hold onto: every one of those sends was permitted. The
 * recipient guard was armed and refused nothing, because the recipients really
 * were internal. What was missing was any limit on *volume* or on *staleness* —
 * so those are what these tests pin.
 *
 * The fail-closed case matters most. A cap that can be bypassed by making a
 * database query fail is not a cap.
 */
import { describe, expect, it } from "vitest";
import {
  AUTONOMOUS_SENDS_PER_HOUR,
  CHAT_SENDS_PER_HOUR,
  checkSendRate,
  sendRateMessage,
} from "./outbound-limits";

/** Supabase stand-in for `select(count exact, head)` with a filter chain. */
function db(result: { count?: number | null; error?: { message: string } | null }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    gte: async () => ({ count: result.count ?? null, error: result.error ?? null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

const ORG = "11111111-1111-1111-1111-111111111111";

describe("the autonomous cap is tight enough to have stopped the incident", () => {
  it("is a single digit", () => {
    // George wanted to send 16 in 90 minutes. Any cap in single digits turns
    // that into something someone notices rather than an inbox event.
    expect(AUTONOMOUS_SENDS_PER_HOUR).toBeLessThan(10);
    expect(AUTONOMOUS_SENDS_PER_HOUR).toBeGreaterThan(0);
  });

  it("is stricter than the human-driven cap", () => {
    // A person clicking send is their own rate limit; an unattended agent is not.
    expect(AUTONOMOUS_SENDS_PER_HOUR).toBeLessThan(CHAT_SENDS_PER_HOUR);
  });

  it("would have refused the 4th unprompted send of the hour", async () => {
    const at3 = await checkSendRate(db({ count: 3 }), ORG, "autonomous");
    expect(at3.allowed).toBe(false);
    expect(at3.cap).toBe(AUTONOMOUS_SENDS_PER_HOUR);
  });

  it("allows normal trickle traffic", async () => {
    const first = await checkSendRate(db({ count: 0 }), ORG, "autonomous");
    expect(first.allowed).toBe(true);
  });

  it("does not apply the autonomous cap to a human in chat", async () => {
    // 5 sends would block an autonomous run but must not block a person.
    const chat = await checkSendRate(db({ count: 5 }), ORG, "chat");
    expect(chat.allowed).toBe(true);
  });
});

describe("the cap fails closed", () => {
  it("refuses when the count cannot be read", async () => {
    // Otherwise a database hiccup is a bypass, and the cap is decorative.
    const v = await checkSendRate(db({ error: { message: "connection reset" } }), ORG, "autonomous");
    expect(v.allowed).toBe(false);
    expect(v.sent).toBe(-1);
  });

  it("says so plainly rather than implying a limit was hit", async () => {
    const v = await checkSendRate(db({ error: { message: "boom" } }), ORG, "autonomous");
    const msg = sendRateMessage(v);
    expect(msg).toContain("couldn't check");
    // The draft must survive — refusing to send is not the same as losing work.
    expect(msg).toContain("draft is saved");
  });

  it("treats a null count as zero rather than unlimited", async () => {
    const v = await checkSendRate(db({ count: null }), ORG, "autonomous");
    expect(v.allowed).toBe(true);
    expect(v.sent).toBe(0);
  });
});

describe("the refusal message is useful to whoever reads it", () => {
  it("names the count, the cap, and where the draft went", async () => {
    const v = await checkSendRate(db({ count: 3 }), ORG, "autonomous");
    const msg = sendRateMessage(v);
    expect(msg).toContain("3");
    expect(msg).toContain(String(AUTONOMOUS_SENDS_PER_HOUR));
    expect(msg).toContain("Drafts folder");
  });

  it("tells the model to escalate rather than route around the limit", async () => {
    const v = await checkSendRate(db({ count: 9 }), ORG, "autonomous");
    expect(sendRateMessage(v)).toContain("raise the limit deliberately");
  });
});

// The staleness gate moved to where work is CREATED (transcript-sync.ts,
// mailbox-sync.ts). Gating on the agent_event's own age was useless: a backfill
// mints fresh events for years-old meetings. Covered by transcript-sync.test.ts.
