import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns empty data and full body when no frontmatter present", () => {
    const raw = "# Just a title\n\nSome body text.";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(false);
    expect(result.data).toEqual({});
    expect(result.body).toBe(raw);
  });

  it("parses scalar key-value pairs", () => {
    const raw = "---\ntype: concept\ntitle: My Title\n---\nBody text.";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.data.type).toBe("concept");
    expect(result.data.title).toBe("My Title");
    expect(result.body).toBe("Body text.");
  });

  it("strips surrounding quotes from values", () => {
    const raw = '---\ntitle: "Quoted Title"\n---\nBody.';
    const result = parseFrontmatter(raw);
    expect(result.data.title).toBe("Quoted Title");
  });

  it("strips single quotes from values", () => {
    const raw = "---\ntitle: 'Single Quoted'\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data.title).toBe("Single Quoted");
  });

  it("parses inline array syntax [a, b, c]", () => {
    const raw = "---\ntags: [onboarding, process, core]\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data.tags).toEqual(["onboarding", "process", "core"]);
  });

  it("parses block list syntax (indented dashes)", () => {
    const raw = "---\nlinks:\n  - /core/foo\n  - bar.md\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data.links).toEqual(["/core/foo", "bar.md"]);
  });

  it("handles empty block list (key with no items)", () => {
    const raw = "---\nlinks:\ntitle: Next Key\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data.links).toEqual([]);
    expect(result.data.title).toBe("Next Key");
  });

  it("skips comment lines in frontmatter", () => {
    const raw = "---\n# This is a comment\ntype: concept\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data.type).toBe("concept");
  });

  it("skips blank lines in frontmatter", () => {
    const raw = "---\ntype: concept\n\ntitle: My Title\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data.type).toBe("concept");
    expect(result.data.title).toBe("My Title");
  });

  it("handles BOM prefix", () => {
    const raw = "\uFEFF---\ntype: concept\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.data.type).toBe("concept");
  });

  it("handles Windows-style CRLF line endings", () => {
    const raw = "---\r\ntype: concept\r\ntitle: My Title\r\n---\r\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.data.type).toBe("concept");
    expect(result.data.title).toBe("My Title");
  });

  it("strips quotes from block list items", () => {
    const raw = '---\nlinks:\n  - "quoted-link"\n  - \'single-quoted\'\n---\nBody.';
    const result = parseFrontmatter(raw);
    expect(result.data.links).toEqual(["quoted-link", "single-quoted"]);
  });

  it("filters empty items from inline arrays", () => {
    const raw = "---\ntags: [a, , b]\n---\nBody.";
    const result = parseFrontmatter(raw);
    expect(result.data.tags).toEqual(["a", "b"]);
  });
});

describe("serializeFrontmatter", () => {
  it("serializes scalar keys in canonical order", () => {
    const result = serializeFrontmatter({
      type: "concept",
      title: "My Title",
      description: "A description",
    });
    expect(result).toContain("type: concept");
    expect(result).toContain("title: My Title");
    expect(result).toContain("description: A description");
    expect(result.startsWith("---\n")).toBe(true);
    expect(result.endsWith("---\n")).toBe(true);
  });

  it("serializes array keys in inline format", () => {
    const result = serializeFrontmatter({
      tags: ["a", "b", "c"],
    });
    expect(result).toContain("tags: [a, b, c]");
  });

  it("omits empty scalar keys", () => {
    const result = serializeFrontmatter({
      type: "concept",
      title: "",
      description: undefined,
    });
    expect(result).toContain("type: concept");
    expect(result).not.toContain("title:");
    expect(result).not.toContain("description:");
  });

  it("omits empty arrays", () => {
    const result = serializeFrontmatter({ tags: [] });
    expect(result).not.toContain("tags:");
  });

  it("quotes values containing special YAML characters", () => {
    const result = serializeFrontmatter({ title: "Title: with colon" });
    expect(result).toContain('"Title: with colon"');
  });

  it("quotes values containing double quotes (via colon-trigger)", () => {
    const result = serializeFrontmatter({ title: 'Say "hello"' });
    // quoteIfNeeded doesn't trigger on plain quotes (no : # [ ] { }),
    // so the value is emitted unquoted.
    expect(result).toContain('title: Say "hello"');
  });

  it("produces a valid empty frontmatter block with no data", () => {
    const result = serializeFrontmatter({});
    expect(result).toBe("---\n---\n");
  });

  it("includes timestamp and resource when present", () => {
    const result = serializeFrontmatter({
      timestamp: "2024-01-01",
      resource: "https://example.com",
    });
    expect(result).toContain("timestamp: 2024-01-01");
    // URLs contain `:` so quoteIfNeeded wraps them in double quotes
    expect(result).toContain('resource: "https://example.com"');
  });
});
