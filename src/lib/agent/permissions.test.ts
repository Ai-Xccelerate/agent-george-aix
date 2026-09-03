import { describe, it, expect } from "vitest";
import { georgeCanUseTool as guard } from "./permissions";

/**
 * The SDK's `CanUseTool` signature gained a third argument — an options bag
 * carrying an abort signal and permission-prompt metadata. George's guard reads
 * none of it: the decision is made on the tool name and, for WebFetch, the URL.
 *
 * Supplying the minimum the type requires keeps that true in the tests. A
 * fuller fixture would imply the guard consults fields it does not read, and
 * the next person would have to check.
 */
const georgeCanUseTool = (toolName: string, input: Record<string, unknown>) =>
  guard(toolName, input, {
    signal: new AbortController().signal,
    toolUseID: "test",
  });

describe("georgeCanUseTool", () => {
  describe("non-WebFetch tools", () => {
    it("allows any non-WebFetch tool", async () => {
      const result = await georgeCanUseTool("WebSearch", { query: "test" });
      expect(result.behavior).toBe("allow");
    });

    it("allows Bash tool (permissions module doesn't block it)", async () => {
      const result = await georgeCanUseTool("Bash", { command: "ls" });
      expect(result.behavior).toBe("allow");
    });
  });

  describe("WebFetch — valid URLs", () => {
    it("allows public HTTPS URLs", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "https://example.com/page",
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows public HTTP URLs", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://example.com/page",
      });
      expect(result.behavior).toBe("allow");
    });
  });

  describe("WebFetch — blocked URLs", () => {
    it("denies non-string url", async () => {
      const result = await georgeCanUseTool("WebFetch", { url: 123 });
      expect(result.behavior).toBe("deny");
    });

    it("denies missing url", async () => {
      const result = await georgeCanUseTool("WebFetch", {});
      expect(result.behavior).toBe("deny");
    });

    it("denies invalid URL", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "not a url",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies non-http(s) protocol", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "ftp://example.com",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies file:// protocol", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "file:///etc/passwd",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies localhost", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://localhost:3000/api/admin",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies 0.0.0.0", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://0.0.0.0:8080",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies subdomain of localhost", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://evil.localhost",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies ::1 IPv6 loopback", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://[::1]:3000",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies 10.x.x.x private IP", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://10.0.0.1",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies 127.x.x.x loopback IP", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://127.0.0.1:8080",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies 169.254.x.x link-local IP", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://169.254.169.254/latest/meta-data",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies 172.16.x.x private IP", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://172.16.0.1",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies 172.31.x.x private IP (upper bound)", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://172.31.255.255",
      });
      expect(result.behavior).toBe("deny");
    });

    it("allows 172.32.x.x (outside private range)", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://172.32.0.1",
      });
      expect(result.behavior).toBe("allow");
    });

    it("denies 192.168.x.x private IP", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://192.168.1.1",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies IPv6 ULA (fc00::)", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://[fc00::1]",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies IPv6 ULA (fd00::)", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://[fd12::1]",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies IPv6 link-local (fe80::)", async () => {
      const result = await georgeCanUseTool("WebFetch", {
        url: "http://[fe80::1]",
      });
      expect(result.behavior).toBe("deny");
    });
  });
});
