import { describe, it, expect } from "vitest";
import { buildOrgBlock, buildKnowledgeBlock } from "./system-prompt";

describe("buildOrgBlock", () => {
  it("returns empty string for null org", () => {
    expect(buildOrgBlock(null)).toBe("");
  });

  it("returns empty string when org has no meaningful fields", () => {
    expect(buildOrgBlock({})).toBe("");
  });

  it("includes display_name when present", () => {
    const block = buildOrgBlock({ display_name: "Onyx" });
    expect(block).toContain("Display name: Onyx");
  });

  it("prefers display_name over name", () => {
    const block = buildOrgBlock({
      name: "Onyx Inc.",
      display_name: "Onyx",
    });
    expect(block).toContain("Display name: Onyx");
    expect(block).toContain("Legal name: Onyx Inc.");
  });

  it("uses name as display when display_name is null", () => {
    const block = buildOrgBlock({ name: "Onyx Inc." });
    expect(block).toContain("Display name: Onyx Inc.");
    expect(block).not.toContain("Legal name:");
  });

  it("includes customer_brand_name", () => {
    const block = buildOrgBlock({
      name: "Onyx",
      customer_brand_name: "Onyx Platform",
    });
    expect(block).toContain("Customer-facing brand: Onyx Platform");
  });

  it("includes domain", () => {
    const block = buildOrgBlock({ name: "Onyx", domain: "getonyx.ai" });
    expect(block).toContain("Primary domain: getonyx.ai");
  });

  it("includes tagline", () => {
    const block = buildOrgBlock({
      name: "Onyx",
      tagline: "The partner platform",
    });
    expect(block).toContain("Tagline: The partner platform");
  });

  it("includes timezone", () => {
    const block = buildOrgBlock({
      name: "Onyx",
      default_timezone: "America/New_York",
    });
    expect(block).toContain("Default timezone: America/New_York");
  });

  it("includes business hours when start and end are set", () => {
    const block = buildOrgBlock({
      name: "Onyx",
      business_hours: {
        start: "09:00",
        end: "17:00",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      },
    });
    expect(block).toContain("Business hours: 09:00\u201317:00");
    expect(block).toContain("Mon, Tue, Wed, Thu, Fri");
  });

  it("includes business hours with partial data", () => {
    const block = buildOrgBlock({
      name: "Onyx",
      business_hours: { start: "09:00" },
    });
    expect(block).toContain("Business hours:");
    expect(block).toContain("09:00");
  });

  it("skips business hours when all fields are empty", () => {
    const block = buildOrgBlock({
      name: "Onyx",
      business_hours: { start: null, end: null, days: [] },
    });
    expect(block).not.toContain("Business hours:");
  });

  it("contains Organization profile heading", () => {
    const block = buildOrgBlock({ name: "Onyx" });
    expect(block).toContain("# Organization profile");
  });
});

describe("buildKnowledgeBlock", () => {
  it("returns empty string for empty docs array", () => {
    expect(buildKnowledgeBlock([])).toBe("");
  });

  it("includes core playbook section for core docs", () => {
    const docs = [
      {
        path: "core/01-onboarding.md",
        title: "Onboarding",
        is_core: true,
        concept_type: "process",
        tags: ["onboarding"],
      },
    ];
    const block = buildKnowledgeBlock(docs);
    expect(block).toContain("## Core playbook");
    expect(block).toContain("`core/01-onboarding.md`");
    expect(block).toContain("Onboarding");
  });

  it("includes supplemental section for non-core docs", () => {
    const docs = [
      {
        path: "supplemental/faq.md",
        title: "FAQ",
        is_core: false,
        concept_type: "reference",
        tags: ["faq"],
      },
    ];
    const block = buildKnowledgeBlock(docs);
    expect(block).toContain("## Supplemental");
    expect(block).toContain("`supplemental/faq.md`");
    expect(block).toContain("FAQ");
  });

  it("separates core and supplemental docs", () => {
    const docs = [
      {
        path: "core/01-process.md",
        title: "Process",
        is_core: true,
        concept_type: null,
        tags: null,
      },
      {
        path: "supplemental/tips.md",
        title: "Tips",
        is_core: false,
        concept_type: null,
        tags: null,
      },
    ];
    const block = buildKnowledgeBlock(docs);
    expect(block).toContain("## Core playbook");
    expect(block).toContain("## Supplemental");
  });

  it("shows (untitled) for docs without title", () => {
    const docs = [
      {
        path: "core/untitled.md",
        title: null,
        is_core: true,
        concept_type: null,
        tags: null,
      },
    ];
    const block = buildKnowledgeBlock(docs);
    expect(block).toContain("(untitled)");
  });

  it("includes concept_type and tags in metadata suffix", () => {
    const docs = [
      {
        path: "supplemental/topic.md",
        title: "Topic",
        is_core: false,
        concept_type: "concept",
        tags: ["tag1", "tag2"],
      },
    ];
    const block = buildKnowledgeBlock(docs);
    expect(block).toContain("concept");
    expect(block).toContain("#tag1");
    expect(block).toContain("#tag2");
  });

  it("includes hybrid RAG policy header", () => {
    const docs = [
      {
        path: "core/x.md",
        title: "X",
        is_core: true,
        concept_type: null,
        tags: null,
      },
    ];
    const block = buildKnowledgeBlock(docs);
    expect(block).toContain("Knowledge base — hybrid RAG policy");
  });
});
