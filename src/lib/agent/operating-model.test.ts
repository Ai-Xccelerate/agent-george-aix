import { describe, it, expect } from "vitest";
import {
  resolvePolicies,
  renderOperatingModelBlock,
  POLICY_CATALOG,
  GUARDRAILS,
  OPERATING_PRINCIPLES,
  type PolicyOverrides,
} from "./operating-model";

describe("GUARDRAILS", () => {
  it("has the expected number of hard guardrails", () => {
    expect(GUARDRAILS.length).toBe(6);
  });

  it("each guardrail has a title and detail", () => {
    for (const g of GUARDRAILS) {
      expect(g.title).toBeTruthy();
      expect(g.detail).toBeTruthy();
    }
  });
});

describe("OPERATING_PRINCIPLES", () => {
  it("has the expected number of principles", () => {
    expect(OPERATING_PRINCIPLES.length).toBe(6);
  });
});

describe("POLICY_CATALOG", () => {
  it("every policy has a unique id", () => {
    const ids = POLICY_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every policy has required fields", () => {
    for (const p of POLICY_CATALOG) {
      expect(p.id).toBeTruthy();
      expect(p.group).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(["toggle", "select", "number", "text"]).toContain(p.kind);
    }
  });
});

describe("resolvePolicies", () => {
  it("returns all catalog defaults when no overrides", () => {
    const resolved = resolvePolicies(null);
    for (const p of POLICY_CATALOG) {
      expect(resolved[p.id]).toBe(p.default);
    }
  });

  it("returns all catalog defaults when overrides is undefined", () => {
    const resolved = resolvePolicies(undefined);
    for (const p of POLICY_CATALOG) {
      expect(resolved[p.id]).toBe(p.default);
    }
  });

  it("returns all catalog defaults when overrides is empty", () => {
    const resolved = resolvePolicies({});
    for (const p of POLICY_CATALOG) {
      expect(resolved[p.id]).toBe(p.default);
    }
  });

  it("applies toggle override as boolean", () => {
    const overrides: PolicyOverrides = {
      email_disclaimer_footer: false,
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.email_disclaimer_footer).toBe(false);
  });

  it("coerces truthy value to true for toggles", () => {
    const overrides: PolicyOverrides = {
      email_disclaimer_footer: 1,
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.email_disclaimer_footer).toBe(true);
  });

  it("applies number override within range", () => {
    const overrides: PolicyOverrides = {
      max_actions: 5,
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.max_actions).toBe(5);
  });

  it("clamps number override to max", () => {
    const overrides: PolicyOverrides = {
      max_actions: 100,
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.max_actions).toBe(10);
  });

  it("clamps number override to min", () => {
    const overrides: PolicyOverrides = {
      max_actions: 0,
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.max_actions).toBe(1);
  });

  it("rounds non-integer number overrides", () => {
    const overrides: PolicyOverrides = {
      max_actions: 3.7,
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.max_actions).toBe(4);
  });

  it("falls back to default for NaN number overrides", () => {
    const overrides: PolicyOverrides = {
      max_actions: "not-a-number",
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.max_actions).toBe(3);
  });

  it("applies text override as string", () => {
    const overrides: PolicyOverrides = {
      house_rules: "Always CC the lead.",
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.house_rules).toBe("Always CC the lead.");
  });

  it("applies select override as string", () => {
    const overrides: PolicyOverrides = {
      reporting_register: "standard",
    };
    const resolved = resolvePolicies(overrides);
    expect(resolved.reporting_register).toBe("standard");
  });
});

describe("renderOperatingModelBlock", () => {
  it("contains the guardrail reaffirmation header", () => {
    const block = renderOperatingModelBlock(null);
    expect(block).toContain("Operating model (configured for this org)");
    expect(block).toContain("guardrails");
  });

  it("includes behavior section with default toggles on", () => {
    const block = renderOperatingModelBlock(null);
    expect(block).toContain("## Behaviors");
    expect(block).toContain("AI-teammate disclaimer footer");
  });

  it("includes limits section", () => {
    const block = renderOperatingModelBlock(null);
    expect(block).toContain("## Limits & framework");
  });

  it("does not include house rules section when empty", () => {
    const block = renderOperatingModelBlock(null);
    expect(block).not.toContain("## House rules");
  });

  it("includes house rules section when custom rules are set", () => {
    const block = renderOperatingModelBlock({
      house_rules: "Always CC the PM lead on renewal drafts.",
    });
    expect(block).toContain("## House rules");
    expect(block).toContain("Always CC the PM lead on renewal drafts.");
  });

  it("uses promptOff for disabled toggles", () => {
    const block = renderOperatingModelBlock({
      email_disclaimer_footer: false,
    });
    expect(block).toContain("Do NOT append the AI-teammate disclaimer footer");
  });

  it("reflects overridden number policies", () => {
    const block = renderOperatingModelBlock({ max_actions: 7 });
    expect(block).toContain("at most 7 actions");
  });

  it("reflects custom renewal offsets", () => {
    const block = renderOperatingModelBlock({
      renewal_offsets: "120, 90, 60, 30",
    });
    expect(block).toContain("T-120");
  });
});
