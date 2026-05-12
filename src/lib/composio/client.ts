import { Composio } from "@composio/core";

/**
 * Composio is our broker for external integrations:
 *   - Microsoft 365 Outlook mail + calendar (george@onyx mailbox)
 *   - Fireflies meeting transcripts
 *   - OneDrive, Slack, etc. as we add them.
 *
 * IDENTITY MODEL — read this carefully.
 *
 *   Composio's "user_id" is George's identity, NOT a human user.
 *   We deliberately use the *org* uuid (`org-<orgId>`) so every human in the
 *   org talks to the same George — the same mailbox, the same calendar, the
 *   same Fireflies account. Adding a new teammate must NEVER trigger an
 *   integration reconnect; integrations are global per org.
 *
 *   See `composioOrgIdentity()` below. Do not introduce a per-user identity
 *   string anywhere — if you do, you'll fork George's connections.
 *
 * The Composio API key (`COMPOSIO_API_KEY`) is workspace-scoped and lives only
 * on the server. Never import this module from a client component.
 */

let cached: Composio | null = null;

export function getComposio(): Composio {
  if (cached) return cached;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "COMPOSIO_API_KEY is not set. Add it to .env.local and reload.",
    );
  }
  cached = new Composio({ apiKey });
  return cached;
}

/**
 * Returns the Composio user_id string for an org — this is George's identity
 * within Composio. Org-scoped on purpose: every human in the org points at
 * the same `org-<orgId>` value, so they share one set of integrations.
 */
export function composioOrgIdentity(orgId: string): string {
  return `org-${orgId}`;
}


/**
 * Result envelope used by every Composio-backed tool wrapper.
 * Mirrors the SDK shape but flattens for our `ok()` / `fail()` helpers.
 */
export type ComposioCall<T = unknown> =
  | { ok: true; data: T; logId?: string }
  | { ok: false; error: string };

export async function callAction<T = Record<string, unknown>>(
  slug: string,
  orgId: string,
  args: Record<string, unknown>,
): Promise<ComposioCall<T>> {
  try {
    const composio = getComposio();
    const result = await composio.tools.execute(slug, {
      userId: composioOrgIdentity(orgId),
      arguments: args,
    });
    if (!result.successful) {
      return { ok: false, error: result.error ?? "Composio reported failure" };
    }
    return { ok: true, data: result.data as T, logId: result.logId };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Composio failure";
    return { ok: false, error: message };
  }
}
