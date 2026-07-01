import { describe, it, expect } from "vitest";
import { extractDomain } from "./sender-allowlist";

describe("extractDomain", () => {
  it("extracts domain from plain email", () => {
    expect(extractDomain("user@example.com")).toBe("example.com");
  });

  it("extracts domain from angle-bracket-wrapped address", () => {
    expect(extractDomain("John Doe <john@example.com>")).toBe("example.com");
  });

  it("normalizes domain to lowercase", () => {
    expect(extractDomain("User@EXAMPLE.COM")).toBe("example.com");
  });

  it("handles angle-bracket wrapping with mixed case", () => {
    expect(extractDomain("Jane <JANE@Test.IO>")).toBe("test.io");
  });

  it("returns null for null input", () => {
    expect(extractDomain(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractDomain(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractDomain("")).toBeNull();
  });

  it("returns null for string without @", () => {
    expect(extractDomain("no-at-sign")).toBeNull();
  });

  it("uses last @ for multi-@ addresses", () => {
    expect(extractDomain("weird@local@final.com")).toBe("final.com");
  });

  it("trims whitespace from the address", () => {
    expect(extractDomain("  user@example.com  ")).toBe("example.com");
  });

  it("handles angle brackets with whitespace inside", () => {
    expect(extractDomain("Name < user@example.com >")).toBe("example.com");
  });
});
