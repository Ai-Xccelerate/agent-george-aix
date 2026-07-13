/**
 * AIX Core entitlement gate — TypeScript port of the reference `core_access.py`
 * from the agent-integration playbook. George is a single Next.js app, so this
 * runs server-side (route handlers, server actions, RSC via getCurrentUser).
 *
 * Contract (fail-closed):
 *   - 401  → Core rejected the Clerk token
 *   - 404  → `george` isn't in the Core catalog yet → treat as 503 (not granted)
 *   - 5xx / network → Core down → 503 (NEVER grant on infrastructure failure)
 *   - has_access:false → 403 no_agent_access (org not enabled / user not assigned)
 *
 * Per-user cache capped at 60s: any longer leaves a user with stale access
 * after an org admin revokes.
 */

const AGENT_ID = "george"; // must match the Core catalog id Deepak registered
const CORE_API = (process.env.AIX_CORE_API_URL ?? "").replace(/\/$/, "");

const TTL_MS = 60_000;
type CacheEntry = { hasAccess: boolean; reason: string | null; at: number };
const cache = new Map<string, CacheEntry>();

export type CoreAccessOutcome =
  | { ok: true; reason: string | null }
  | { ok: false; kind: "denied" | "unavailable"; status: number; reason: string | null; message: string };

/**
 * Ask Core whether this user may use George. Returns a structured outcome
 * rather than throwing, so callers (getCurrentUser, the app layout, API
 * routes) can render the right UX. `jwt` is the Clerk session token
 * (`await auth().getToken()` / forwarded Authorization bearer).
 */
export async function checkCoreAccess(clerkUserId: string, jwt: string): Promise<CoreAccessOutcome> {
  if (!CORE_API) {
    return { ok: false, kind: "unavailable", status: 503, reason: null, message: "AIX_CORE_API_URL is not set" };
  }

  const cached = cache.get(clerkUserId);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.hasAccess
      ? { ok: true, reason: cached.reason }
      : deny(cached.reason);
  }

  let res: Response;
  try {
    res = await fetch(`${CORE_API}/api/v1/agents/${AGENT_ID}/access`, {
      headers: { Authorization: `Bearer ${jwt}` },
      // Never cache at the fetch layer; we own the TTL above.
      cache: "no-store",
    });
  } catch {
    // Core unreachable → fail closed, do NOT cache (retry next call).
    return { ok: false, kind: "unavailable", status: 503, reason: null, message: "AIX Core unreachable" };
  }

  if (res.status === 401) {
    return { ok: false, kind: "unavailable", status: 401, reason: null, message: "Token rejected by AIX Core" };
  }
  if (res.status === 404) {
    return { ok: false, kind: "unavailable", status: 503, reason: "unknown_agent", message: `${AGENT_ID} is not registered in the AIX Core catalog` };
  }
  if (res.status >= 500) {
    return { ok: false, kind: "unavailable", status: 503, reason: null, message: `AIX Core /access failed: ${res.status}` };
  }

  const data = (await res.json().catch(() => ({}))) as { has_access?: boolean; reason?: string };
  const hasAccess = Boolean(data.has_access);
  // Only definitive answers get cached; errors above always retry.
  cache.set(clerkUserId, { hasAccess, reason: data.reason ?? null, at: Date.now() });

  return hasAccess ? { ok: true, reason: data.reason ?? null } : deny(data.reason ?? null);
}

/**
 * Thrown by getCurrentUser when Core denies or is unavailable, so the
 * authenticated app layout can render the denied/unavailable screen instead
 * of a redirect loop. Allowed users never hit this (checkCoreAccess returns ok).
 */
export class CoreAccessError extends Error {
  constructor(public outcome: Extract<CoreAccessOutcome, { ok: false }>) {
    super(outcome.message);
    this.name = "CoreAccessError";
  }
}

function deny(reason: string | null): CoreAccessOutcome {
  return {
    ok: false,
    kind: "denied",
    status: 403,
    reason,
    message: `You don't have access to ${AGENT_ID}. Ask your org admin to grant access from the AIX Core dashboard.`,
  };
}
