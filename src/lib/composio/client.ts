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
  // `allowAutoUploadDownloadFiles: true` unlocks Composio actions whose
  // schemas declare a file field (e.g. OUTLOOK_CREATE_DRAFT's attachments).
  // We never actually upload a file from George today — the flag just lets
  // the SDK proceed when the schema mentions one. `fileUploadDirs: []`
  // keeps the on-disk read allowlist empty, so even if a model tried to
  // sneak a path through, the SDK would have no directory to read from.
  cached = new Composio({
    apiKey,
    // Unlocks Composio actions whose schemas declare a file field (e.g.
    // OUTLOOK_CREATE_DRAFT's attachments). George never actually uploads
    // a file from disk today — this just lets the SDK proceed when the
    // schema *mentions* one. `fileUploadDirs: false` disables the local
    // file-read allowlist entirely, so even if a path slipped into args
    // the SDK has nowhere on disk it's allowed to read from.
    dangerouslyAllowAutoUploadDownloadFiles: true,
    fileUploadDirs: false,
  });
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

/**
 * Composio trigger subscriptions (e.g. OUTLOOK_MESSAGE_TRIGGER — the
 * near-real-time "new mail" webhook) aren't exposed by the @composio/core
 * SDK we're on (0.9.x has no triggers module), so this hits the REST API
 * directly, same pattern as scripts/verify-composio.ts.
 *
 * IMPORTANT: a trigger instance is pinned to a specific connected_account_id,
 * not to the org's Composio identity in general. Reconnecting/re-authing an
 * integration mints a NEW connected_account_id, which silently orphans any
 * trigger tied to the old one — Composio does not migrate it. That's why
 * this is called from the OAuth callback (see
 * src/app/api/integrations/composio/callback/route.ts) every time a
 * connection completes, not just once at initial setup.
 */
export async function ensureTrigger(
  triggerName: string,
  connectedAccountId: string,
): Promise<ComposioCall<{ trigger_id: string }>> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return { ok: false, error: "COMPOSIO_API_KEY is not set." };
  try {
    const res = await fetch(
      `https://backend.composio.dev/api/v3/trigger_instances/${triggerName}/upsert`,
      {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          connected_account_id: connectedAccountId,
          trigger_config: {},
        }),
      },
    );
    const body = (await res.json()) as { trigger_id?: string; error?: { message?: string } };
    if (!res.ok || !body.trigger_id) {
      const message = body.error?.message ?? `HTTP ${res.status}`;
      console.error("[composio] trigger upsert failed", { triggerName, connectedAccountId, message });
      return { ok: false, error: message };
    }
    return { ok: true, data: { trigger_id: body.trigger_id } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Composio failure";
    console.error("[composio] trigger upsert threw", { triggerName, connectedAccountId, message });
    return { ok: false, error: message };
  }
}

/** The org's currently-active connected account for a toolkit, if any. */
export async function activeConnectedAccountId(
  orgId: string,
  toolkitSlug: string,
): Promise<string | null> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://backend.composio.dev/api/v3/connected_accounts?user_ids=${encodeURIComponent(composioOrgIdentity(orgId))}&toolkit_slugs=${toolkitSlug.toLowerCase()}`,
      { headers: { "x-api-key": apiKey } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      items?: { id: string; status: string; toolkit?: { slug?: string } }[];
    };
    return body.items?.find((a) => a.status === "ACTIVE")?.id ?? null;
  } catch {
    return null;
  }
}

/** Whether a trigger instance is currently active for this exact connected account. */
export async function isTriggerActiveFor(
  triggerName: string,
  connectedAccountId: string,
): Promise<boolean> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return false;
  try {
    const res = await fetch("https://backend.composio.dev/api/v3/trigger_instances/active", {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      items?: { connected_account_id: string; trigger_name: string }[];
    };
    return (body.items ?? []).some(
      (t) => t.connected_account_id === connectedAccountId && t.trigger_name === triggerName,
    );
  } catch {
    return false;
  }
}

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
      // Composio 0.9.x refuses execution unless a toolkit version is pinned
      // OR this flag is set. We accept "latest" — pinning per-toolkit means
      // we'd have to track Outlook / Fireflies / OneDrive version dates and
      // update them as Composio publishes new ones. Skip the gate, take the
      // risk of an upstream schema tweak, fix it forward if it bites.
      dangerouslySkipVersionCheck: true,
    });
    if (!result.successful) {
      // Surface the full failure envelope to logs so we can tell apart
      // missing-connection vs missing-scope vs bad-args without guessing.
      // Composio sometimes returns the meaningful detail inside `data` or
      // nested error fields rather than just the top-level `error` string.
      console.error("[composio] action failed", {
        slug,
        userId: composioOrgIdentity(orgId),
        error: result.error,
        data: result.data,
      });
      return { ok: false, error: result.error ?? "Composio reported failure" };
    }
    return { ok: true, data: result.data as T, logId: result.logId };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Composio failure";
    console.error("[composio] action threw", {
      slug,
      userId: composioOrgIdentity(orgId),
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { ok: false, error: message };
  }
}
