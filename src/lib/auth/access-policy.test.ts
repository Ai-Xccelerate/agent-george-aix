import { describe, it, expect } from "vitest";
import {
  emailDomain,
  isAllowedEmail,
  ALLOWED_DOMAINS,
  AIX_ORG_ID,
} from "./access-policy";

describe("emailDomain", () => {
  it("extracts domain from a standard email", () => {
    expect(emailDomain("user@aixccelerate.com")).toBe("aixccelerate.com");
  });

  it("extracts domain from a mixed-case email", () => {
    expect(emailDomain("User@AiXccelerate.CoM")).toBe("aixccelerate.com");
  });

  it("uses the last @ for multi-@ addresses", () => {
    expect(emailDomain("user@local@aixccelerate.com")).toBe("aixccelerate.com");
  });

  it("returns null for null input", () => {
    expect(emailDomain(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(emailDomain(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(emailDomain("")).toBeNull();
  });

  it("returns null for string without @", () => {
    expect(emailDomain("no-at-sign")).toBeNull();
  });

  it("trims whitespace from the domain", () => {
    expect(emailDomain("user@ aixccelerate.com ")).toBe("aixccelerate.com");
  });
});

describe("isAllowedEmail", () => {
  it("allows aixccelerate.com emails", () => {
    expect(isAllowedEmail("admin@aixccelerate.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAllowedEmail("Admin@AIXCCELERATE.COM")).toBe(true);
  });

  it("rejects unrecognized domains", () => {
    expect(isAllowedEmail("user@gmail.com")).toBe(false);
  });

  it("no longer allows getonyx.ai", () => {
    expect(isAllowedEmail("user@getonyx.ai")).toBe(false);
  });

  it("rejects null", () => {
    expect(isAllowedEmail(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAllowedEmail("")).toBe(false);
  });

  it("rejects emails without @", () => {
    expect(isAllowedEmail("notanemail")).toBe(false);
  });

  it("rejects subdomain spoofing", () => {
    expect(isAllowedEmail("user@evil.aixccelerate.com")).toBe(false);
  });
});

describe("constants", () => {
  it("has the expected allowed domains", () => {
    expect(ALLOWED_DOMAINS).toContain("aixccelerate.com");
    expect(ALLOWED_DOMAINS).toHaveLength(1);
  });

  it("has the expected default org ID", () => {
    expect(AIX_ORG_ID).toBe("00000000-0000-0000-0000-000000000001");
  });
});
