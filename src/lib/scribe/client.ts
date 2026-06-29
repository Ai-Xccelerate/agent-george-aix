/**
 * Minimal server-side client for Scribe's remote MCP server, used by the
 * background transcript sync (NOT the agent — the agent reaches Scribe through
 * the SDK's mcpServers wiring in src/lib/agent/scribe.ts).
 *
 * Scribe speaks MCP over streamable HTTP and answers `tools/call` statelessly
 * (no initialize handshake needed for a one-shot call). Each tool returns its
 * payload as a JSON string inside result.content[0].text, which we parse.
 *
 * Server-only — never import from a client component.
 */

const SCRIBE_VERSION = "2024-11-05";

export type ScribeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function scribeEnv(): { url: string; token: string } | null {
  const url = process.env.SCRIBE_MCP_URL?.trim();
  const token = process.env.SCRIBE_MCP_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

export function isScribeAvailable(): boolean {
  return scribeEnv() !== null;
}

/** Pull the JSON-RPC envelope out of either a plain-JSON or SSE response body. */
function parseEnvelope(body: string): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  // SSE framing: one or more `data: {...}` lines — take the last data line.
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) throw new Error("empty Scribe response");
  return JSON.parse(dataLines[dataLines.length - 1]);
}

/**
 * Call a Scribe MCP tool and return its parsed payload. The tool's text content
 * is itself JSON (an array or object), so callers get a typed value directly.
 */
export async function callScribeTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ScribeResult<T>> {
  const env = scribeEnv();
  if (!env) return { ok: false, error: "Scribe is not configured." };

  try {
    const res = await fetch(env.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args, protocolVersion: SCRIBE_VERSION },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `Scribe ${name} HTTP ${res.status}` };
    }

    const envelope = parseEnvelope(await res.text()) as {
      error?: { message?: string };
      result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
    };

    if (envelope.error) {
      return { ok: false, error: envelope.error.message ?? `Scribe ${name} error` };
    }
    const text = envelope.result?.content?.find((c) => c.type === "text")?.text;
    if (text == null) {
      // Some tools may return non-text content; surface the raw result.
      return { ok: true, data: (envelope.result ?? null) as T };
    }
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      // Not JSON — return the raw string (callers that expect text handle it).
      return { ok: true, data: text as unknown as T };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
