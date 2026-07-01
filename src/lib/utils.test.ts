import { describe, it, expect } from "vitest";
import { cn, initials } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("resolves Tailwind conflicts (last wins)", () => {
    const result = cn("px-2", "px-4");
    expect(result).toBe("px-4");
  });

  it("handles conditional classes", () => {
    const result = cn("base", false && "hidden", "extra");
    expect(result).toBe("base extra");
  });

  it("handles undefined and null inputs", () => {
    expect(cn("base", undefined, null, "extra")).toBe("base extra");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });
});

describe("initials", () => {
  it("returns two-letter initials from full name", () => {
    expect(initials("John Doe")).toBe("JD");
  });

  it("returns single initial for single name", () => {
    expect(initials("John")).toBe("J");
  });

  it("returns uppercase initials", () => {
    expect(initials("jane doe")).toBe("JD");
  });

  it("takes only first two initials from three+ word names", () => {
    expect(initials("John Michael Doe")).toBe("JM");
  });

  it("handles empty string", () => {
    expect(initials("")).toBe("");
  });

  it("handles names with extra spaces", () => {
    expect(initials("  John   Doe  ")).toBe("JD");
  });
});
