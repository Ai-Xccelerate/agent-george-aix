import { describe, it, expect } from "vitest";
import {
  extractTenantId,
  isFromAllowedTenant,
  extractConversationId,
} from "./tenant-gate";

describe("extractTenantId", () => {
  it("reads tenantId from conversation", () => {
    expect(extractTenantId({ conversation: { tenantId: "tid-1" } })).toBe(
      "tid-1",
    );
  });

  it("falls back to channelData.tenant.id", () => {
    expect(
      extractTenantId({ channelData: { tenant: { id: "tid-2" } } }),
    ).toBe("tid-2");
  });

  it("prefers conversation.tenantId over channelData", () => {
    expect(
      extractTenantId({
        conversation: { tenantId: "tid-1" },
        channelData: { tenant: { id: "tid-2" } },
      }),
    ).toBe("tid-1");
  });

  it("returns null when neither is present", () => {
    expect(extractTenantId({})).toBeNull();
  });
});

describe("isFromAllowedTenant", () => {
  it("accepts a matching tenant", () => {
    expect(
      isFromAllowedTenant({ conversation: { tenantId: "onyx-tid" } }, "onyx-tid"),
    ).toBe(true);
  });

  it("rejects a mismatched tenant", () => {
    expect(
      isFromAllowedTenant({ conversation: { tenantId: "other-tid" } }, "onyx-tid"),
    ).toBe(false);
  });

  it("rejects when the activity has no tenant at all", () => {
    expect(isFromAllowedTenant({}, "onyx-tid")).toBe(false);
  });

  it("rejects when no expected tenant is configured", () => {
    expect(
      isFromAllowedTenant({ conversation: { tenantId: "onyx-tid" } }, undefined),
    ).toBe(false);
  });

  it("rejects when the expected tenant is an empty string", () => {
    expect(isFromAllowedTenant({ conversation: { tenantId: "onyx-tid" } }, "")).toBe(
      false,
    );
  });
});

describe("extractConversationId", () => {
  it("reads the conversation id", () => {
    expect(extractConversationId({ conversation: { id: "conv-1" } })).toBe(
      "conv-1",
    );
  });

  it("returns null when there is no conversation", () => {
    expect(extractConversationId({})).toBeNull();
  });
});
