/**
 * The sub-agent's grant, and the precedence rules that decide what it writes.
 *
 * The grant is the safety property: `send_email_draft` reaches customers, and
 * this is the only agent that holds it. A test that only checked the prompt
 * text would pass while the grant leaked, so the grant is asserted directly.
 */
import { describe, expect, it } from "vitest";
import {
  buildOnboardingAgent,
  ONBOARDING_AGENT_TOOLS,
  resolveOnboardingVoice,
  type OnboardingAgentInput,
} from "./onboarding-agent";
import { assessOnboarding, type OnboardingFacts } from "./onboarding-state";
import type { TenantProcess } from "./tenant-process";

const NOW = new Date("2026-03-10T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const PROCESS: TenantProcess = {
  id: "p1",
  orgId: "org1",
  type: "onboarding",
  objective: "Get to first value quickly.",
  stages: [{ key: "signed", name: "Signed", description: "Contract executed." }],
  touchpoints: [{ key: "welcome", day_offset: 0, purpose: "Introduce.", ask: "Confirm contact." }],
  escalation: { silence_days: 5, silence_escalate_after: 2, rules: [], notify: "owner" },
  voice: "Plain and short.",
  firstValue: {
    label: "First campaign sent",
    definition: "They sent a real campaign.",
    target_days: 21,
    evidence: "Someone confirms.",
    configured: true,
  },
};

function facts(over: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    now: NOW,
    contract: { signed_at: daysAgo(3), start_date: daysAgo(3), end_date: null },
    plan: { start_date: daysAgo(3), target_end_date: null, status: "in_progress" },
    steps: [],
    objectives: [],
    health: null,
    touchpoints: [],
    silenceDays: 5,
    firstValue: PROCESS.firstValue,
    ...over,
  };
}

function input(over: Partial<OnboardingAgentInput> = {}): OnboardingAgentInput {
  return {
    process: PROCESS,
    assessment: assessOnboarding(facts()),
    touchpoint: PROCESS.touchpoints[0],
    recipient: { email: "dana@acme.example", name: "Dana Rowe", role: "champion" },
    accountBlock: "# Account\n- Name: Acme",
    personalityPrompt: "Be warm and consultative.",
    requireApproval: true,
    ...over,
  };
}

describe("the tool grant is the safety property", () => {
  it("holds send_email_draft", () => {
    expect(buildOnboardingAgent(input()).tools).toContain("mcp__george__send_email_draft");
  });

  it("names its tools explicitly rather than inheriting the parent's", () => {
    // Omitting `tools` means "inherit everything", which would hand this agent
    // the whole surface. The explicit list IS the mechanism.
    const def = buildOnboardingAgent(input());
    expect(Array.isArray(def.tools)).toBe(true);
    expect(def.tools!.length).toBeGreaterThan(0);
  });

  it("does not quietly acquire tools outside onboarding's remit", () => {
    // A grant that grows without anyone noticing is how blast radius returns.
    for (const t of ONBOARDING_AGENT_TOOLS) expect(t.startsWith("mcp__george__")).toBe(true);
    for (const forbidden of [
      "mcp__george__create_customer",
      "mcp__george__set_customer_owner",
      "mcp__george__propose_knowledge",
      "mcp__george__request_domain_approval",
    ]) {
      expect(ONBOARDING_AGENT_TOOLS).not.toContain(forbidden);
    }
  });

  it("reuses the parent's George server rather than standing up its own", () => {
    // Same org scoping, same audit actor. A private server would be a second
    // path to the same data with its own configuration to get wrong.
    expect(buildOnboardingAgent(input()).mcpServers).toEqual(["george"]);
  });
});

describe("voice overrides personality, and only here", () => {
  it("prefers the tenant's process voice", () => {
    const v = resolveOnboardingVoice("Blunt and factual.", "Be warm and consultative.");
    expect(v).toEqual({ instruction: "Blunt and factual.", source: "process_voice" });
  });

  it("falls back to personality when the process states no voice", () => {
    const v = resolveOnboardingVoice(null, "Be warm and consultative.");
    expect(v.source).toBe("agent_personality");
  });

  it("treats whitespace as no voice, so a blank field does not silence personality", () => {
    expect(resolveOnboardingVoice("   ", "Be warm.").source).toBe("agent_personality");
  });

  it("reports none when neither is set, rather than inventing a tone", () => {
    expect(resolveOnboardingVoice(null, null)).toEqual({ instruction: "", source: "none" });
  });

  it("puts the winning voice in the prompt and the loser nowhere", () => {
    const prompt = buildOnboardingAgent(input()).prompt;
    expect(prompt).toContain("Plain and short.");
    expect(prompt).not.toContain("Be warm and consultative.");
  });
});

describe("the recipient is given, never chosen", () => {
  it("states the resolved recipient and its role", () => {
    const prompt = buildOnboardingAgent(input()).prompt;
    expect(prompt).toContain("dana@acme.example");
    expect(prompt).toContain("champion");
  });

  it("forbids inventing one when the account record has nobody", () => {
    const prompt = buildOnboardingAgent(input({ recipient: null })).prompt;
    expect(prompt).toContain("Do not choose one");
    expect(prompt).toMatch(/transcript/);
    expect(prompt).toContain("Raise a decision");
  });
});

describe("state reaches the prompt as a decision, not as rows", () => {
  it("carries the computed state", () => {
    const quiet = assessOnboarding(
      facts({
        touchpoints: [
          { touchpoint_key: "welcome", status: "sent", sent_at: daysAgo(9), replied_at: null },
        ],
      }),
    );
    const prompt = buildOnboardingAgent(input({ assessment: quiet })).prompt;
    expect(prompt).toContain("gone_quiet");
    expect(prompt).toContain("easier to answer than to ignore");
  });

  it("tells the agent the state outranks the touchpoint's own script", () => {
    expect(buildOnboardingAgent(input()).prompt).toContain("the state wins");
  });

  it("warns that success cannot be claimed when first value is undefined", () => {
    const undefinedFv = { ...PROCESS, firstValue: { ...PROCESS.firstValue, configured: false } };
    const a = assessOnboarding(facts({ firstValue: undefinedFv.firstValue }));
    const prompt = buildOnboardingAgent(input({ process: undefinedFv, assessment: a })).prompt;
    expect(prompt).toContain("NOT DEFINED");
    expect(prompt).toMatch(/must not claim onboarding is succeeding/);
  });
});

describe("approval is stated as a constraint on the agent", () => {
  it("tells it not to send, and that the draft must be finished", () => {
    const prompt = buildOnboardingAgent(input()).prompt;
    expect(prompt).toContain("Do not send");
    expect(prompt).toContain("not a sketch");
  });

  it("drops the approval block when approval is not required", () => {
    const prompt = buildOnboardingAgent(input({ requireApproval: false })).prompt;
    expect(prompt).not.toContain("Nothing you write is sent by you");
  });
});

describe("the one-ask rule survives into the prompt", () => {
  it("states it with the reason, not as a bare rule", () => {
    const prompt = buildOnboardingAgent(input()).prompt;
    expect(prompt).toContain("One ask, with a date");
    expect(prompt).toContain("Three requests gets zero replies");
  });
});
