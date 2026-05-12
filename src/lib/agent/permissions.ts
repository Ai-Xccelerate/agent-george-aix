import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Allow-by-default permission handler with a hard block on WebFetch targets
 * that resolve to localhost or private/link-local IP ranges. Stops the most
 * obvious SSRF pattern (e.g. fetching http://localhost:3000/api/admin).
 *
 * This is a "first line" check — it inspects the URL the model proposes, not
 * what DNS resolves to at request time. A determined adversary with control
 * over a public DNS record could still point a public hostname at a private
 * IP. For Vercel deployments, Fluid Compute does not expose private RFC1918
 * networks, so this remains effective in practice.
 */
export const georgeCanUseTool: CanUseTool = async (toolName, input) => {
  if (toolName === "WebFetch") {
    const raw = (input as { url?: unknown }).url;
    if (typeof raw !== "string") {
      return { behavior: "deny", message: "WebFetch requires a string `url`." };
    }
    const verdict = isUrlSafe(raw);
    if (!verdict.ok) {
      return { behavior: "deny", message: verdict.reason };
    }
  }
  return { behavior: "allow", updatedInput: input };
};

function isUrlSafe(raw: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: `Invalid URL: ${raw}` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: `Only http(s) URLs are allowed (got ${u.protocol}).` };
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return { ok: false, reason: "WebFetch cannot target localhost." };
  }
  // IPv4 literal — block 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return { ok: false, reason: `WebFetch cannot target private IP ${host}.` };
    }
  }
  // IPv6 ULA / link-local.
  if (/^\[?(fc|fd|fe80)/i.test(host)) {
    return { ok: false, reason: `WebFetch cannot target private/link-local IPv6 ${host}.` };
  }
  return { ok: true };
}
