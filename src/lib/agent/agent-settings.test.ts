import { describe, it, expect } from "vitest";
import {
  personalityLabel,
  personalityPrompt,
  operatingModeLabel,
  AGENT_DEFAULTS,
  PERSONALITY_OPTIONS,
  OPERATING_MODE_OPTIONS,
  TIMEZONE_OPTIONS,
  DEFAULT_TIMEZONE,
} from "./agent-settings";

describe("personalityLabel", () => {
  it("returns label for concise_direct", () => {
    expect(personalityLabel("concise_direct")).toBe("Concise & Direct");
  });

  it("returns label for warm_consultative", () => {
    expect(personalityLabel("warm_consultative")).toBe("Warm & Consultative");
  });

  it("returns label for formal", () => {
    expect(personalityLabel("formal")).toBe("Formal");
  });

  it("returns the raw value for unknown personality", () => {
    expect(personalityLabel("unknown" as "concise_direct")).toBe("unknown");
  });
});

describe("personalityPrompt", () => {
  it("returns prompt for concise_direct", () => {
    const prompt = personalityPrompt("concise_direct");
    expect(prompt).toContain("Concise & Direct");
    expect(prompt).toContain("terse");
  });

  it("returns prompt for warm_consultative", () => {
    const prompt = personalityPrompt("warm_consultative");
    expect(prompt).toContain("Warm & Consultative");
    expect(prompt).toContain("friendly");
  });

  it("returns prompt for formal", () => {
    const prompt = personalityPrompt("formal");
    expect(prompt).toContain("Formal");
    expect(prompt).toContain("professional");
  });

  it("falls back to first option prompt for unknown personality", () => {
    const prompt = personalityPrompt("unknown" as "concise_direct");
    expect(prompt).toBe(PERSONALITY_OPTIONS[0].prompt);
  });
});

describe("operatingModeLabel", () => {
  it("returns label for assistant mode", () => {
    expect(operatingModeLabel("assistant")).toBe("Mode A — Assistant");
  });

  it("returns label for operator mode", () => {
    expect(operatingModeLabel("operator")).toBe(
      "Mode B — Independent operator",
    );
  });

  it("returns raw value for unknown mode", () => {
    expect(operatingModeLabel("unknown" as "assistant")).toBe("unknown");
  });
});

describe("AGENT_DEFAULTS", () => {
  it("has the expected default values", () => {
    expect(AGENT_DEFAULTS.name).toBe("George");
    expect(AGENT_DEFAULTS.title).toBe("AI Customer Success Teammate");
    expect(AGENT_DEFAULTS.bio).toBeNull();
    expect(AGENT_DEFAULTS.personality).toBe("concise_direct");
    expect(AGENT_DEFAULTS.operating_mode).toBe("assistant");
    expect(AGENT_DEFAULTS.owner_user_id).toBeNull();
    expect(AGENT_DEFAULTS.avatar_path).toBeNull();
    expect(AGENT_DEFAULTS.operating_policy).toEqual({});
    expect(AGENT_DEFAULTS.knowledge_reviewers).toEqual([]);
  });
});

describe("constants", () => {
  it("has three personality options", () => {
    expect(PERSONALITY_OPTIONS).toHaveLength(3);
  });

  it("has two operating mode options", () => {
    expect(OPERATING_MODE_OPTIONS).toHaveLength(2);
  });

  it("has at least one timezone option", () => {
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(0);
  });

  it("default timezone is US Pacific", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Los_Angeles");
  });
});
