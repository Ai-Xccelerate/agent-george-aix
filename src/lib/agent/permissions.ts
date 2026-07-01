import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Allow-by-default permission handler with a hard block on WebFetch targets
 * that resolve to localhost or private/link-local IP ranges. Stops the most
 * obvious SSRF pattern (e.g. fetching http://localhost:3000/api/admin).
 *
 * This is a "first line" check — it inspects the URL the model proposes, not
 * what DNS resolves to at request time. A determined adversary with control
 * over a public DNS record could still point a public hostname at a private
 * IP; treat this as defense-in-depth, not a complete SSRF boundary. It DOES
 * canonicalize obfuscated literals (decimal/hex/octal integer forms and
 * IPv4-mapped IPv6) so `http://2130706433` and `http://[::ffff:127.0.0.1]`
 * can't slip a private target past a naive dotted-quad match.
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
  // Canonicalize obfuscated IPv4 literals (dotted decimal, single 32-bit
  // integer, hex/octal octets, IPv4-mapped IPv6) to a dotted quad, then block
  // 0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16.
  const ip = canonicalIpv4(host);
  if (ip) {
    const [a, b] = ip.split(".").map((n) => parseInt(n, 10));
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return { ok: false, reason: `WebFetch cannot target private IP (${host} → ${ip}).` };
    }
  }
  // IPv6 ULA / link-local.
  if (/^\[?(fc|fd|fe80)/i.test(host)) {
    return { ok: false, reason: `WebFetch cannot target private/link-local IPv6 ${host}.` };
  }
  return { ok: true };
}

/**
 * Resolve a host to a dotted-quad IPv4 string if it denotes one, else null.
 * Handles the classic SSRF-bypass encodings: a bare 32-bit integer
 * (`2130706433`), hex/octal octets (`0x7f.0.0.1`, `0177.0.0.1`), fewer-than-4
 * parts (`127.1`), and IPv4-mapped IPv6 (`::ffff:127.0.0.1`). Non-numeric
 * hostnames (real domains) return null and are left alone.
 */
function canonicalIpv4(host: string): string | null {
  let h = host.replace(/^\[/, "").replace(/\]$/, "");
  if (h.includes(":")) {
    // IPv4-mapped/compatible IPv6 — pull the trailing dotted-quad if present.
    const mapped = h.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (!mapped) return null;
    h = mapped[1];
  }

  const parts = h.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const p of parts) {
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  // inet_aton semantics: leading parts are single bytes; the final part fills
  // the remaining low-order bytes.
  let value = 0;
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] > 255) return null;
    value = value * 256 + nums[i];
  }
  const restBytes = 4 - (nums.length - 1);
  const rest = nums[nums.length - 1];
  if (rest > Math.pow(256, restBytes) - 1) return null;
  value = value * Math.pow(256, restBytes) + rest;
  if (value < 0 || value > 0xffffffff) return null;

  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}
