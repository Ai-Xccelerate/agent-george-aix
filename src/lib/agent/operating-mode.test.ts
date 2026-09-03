/**
 * The mode has to decide the grant, not just the prompt.
 *
 * `operating_mode` existed for months as a sentence in the system prompt
 * telling George to ask before acting. Nothing enforced it. This suite is the
 * difference between that and a mechanism: it asserts the TOOL LIST, because a
 * test on the prompt text would pass just as happily while `raise_decision`
 * stayed reachable — which is exactly the state it was in.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildGeorgeMcpServer } from "./tools";
import { clearOperatingModeCache, renderAutonomyBlock } from "./operating-mode";

const ORG = "org-1";

/** The builder constructs a client eagerly; the grant is what is under test. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubDb = { from: () => ({}) } as any;

type Ctx = Parameters<typeof buildGeorgeMcpServer>[0];

function grant(over: Partial<Ctx> = {}) {
  return buildGeorgeMcpServer({ orgId: ORG, userId: null, db: stubDb, ...over } as Ctx).toolNames;
}

const RAISE = "mcp__george__raise_decision";
const OBSERVE = "mcp__george__record_observation";

beforeEach(() => clearOperatingModeCache());

describe("what an autonomous run in assistant mode may reach", () => {
  it("does not hold raise_decision", () => {
    // The safety property, asserted directly. One broken mailbox produced 34
    // escalations; the fix is that the tool is not there, not that George is
    // asked nicely to use it less.
    expect(grant({ mayRaiseDecisions: false })).not.toContain(RAISE);
  });

  it("holds record_observation instead", () => {
    // Withholding the tool without giving him somewhere to put what he noticed
    // would mean the noticing is simply lost.
    expect(grant({ mayRaiseDecisions: false })).toContain(OBSERVE);
  });

  it("keeps everything it needs to observe with", () => {
    // Assistant mode changes what he does with what he finds. It must not stop
    // him finding it.
    const g = grant({ mayRaiseDecisions: false });
    for (const t of ["get_customer", "list_customers", "record_health_check", "list_objectives"]) {
      expect(g).toContain(`mcp__george__${t}`);
    }
  });
});

describe("what a run with a human present may reach", () => {
  it("holds raise_decision when the caller allows it", () => {
    expect(grant({ mayRaiseDecisions: true })).toContain(RAISE);
  });

  it("defaults to allowing it, so a chat run keeps the full grant", () => {
    // The request IS the authorisation. Defaulting closed would silently
    // degrade the one path where a person is sitting there asking.
    expect(grant()).toContain(RAISE);
  });

  it("still offers record_observation — it is not the poor relation", () => {
    expect(grant({ mayRaiseDecisions: true })).toContain(OBSERVE);
  });
});

describe("the prompt says the same thing the grant does", () => {
  it("tells George the tool is absent, in assistant mode", () => {
    const block = renderAutonomyBlock("assistant");
    expect(block).toContain("record_observation");
    expect(block).toMatch(/not available to you/i);
  });

  it("does not claim the tool is absent when it is present", () => {
    // The drift that matters: a prompt telling George he cannot raise decisions
    // while the grant still holds the tool. He would believe the prompt, and
    // the restraint would be back to being advisory.
    const block = renderAutonomyBlock("operator");
    expect(block).not.toMatch(/not available to you/i);
    expect(block).toMatch(/may raise a decision/i);
  });
});
