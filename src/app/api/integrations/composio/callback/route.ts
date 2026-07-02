import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureTrigger } from "@/lib/composio/client";

// Toolkit -> Composio trigger(s) that must be (re)pointed at a fresh
// connected_account_id every time that toolkit finishes (re)connecting.
// A trigger is pinned to one connected_account_id and does NOT migrate when
// the account is re-authed, so without this a reconnect silently kills
// real-time delivery until someone notices mail is only arriving on the
// 10-minute mailbox_sync backstop (see mailbox-sync.ts).
const TOOLKIT_TRIGGERS: Record<string, string[]> = {
  OUTLOOK: ["OUTLOOK_MESSAGE_TRIGGER"],
};

export const dynamic = "force-dynamic";

/**
 * Composio redirects here after the user finishes provider OAuth.
 * Query string carries `?status=success&connected_account_id=ca_...&toolkit=OUTLOOK`
 * (toolkit comes from the URL we built in connectToolkitAction).
 *
 * Connection status is read live from Composio (see `listOrgIntegrations`) —
 * the single source of truth — so we don't cache it here; a cached row would
 * go stale on token expiry and lie. We just log the connect and bounce the
 * user back to /settings/integrations.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // Behind Railway / any proxy the inbound `req.url` host is the internal
  // bind address (e.g. 0.0.0.0:8080) which is unreachable from the user's
  // browser. Prefer NEXT_PUBLIC_APP_URL when set so post-OAuth redirects
  // land on the public domain.
  const redirectBase = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL)
    : url;
  const status = url.searchParams.get("status") ?? "unknown";
  const connectedAccountId =
    url.searchParams.get("connected_account_id") ??
    url.searchParams.get("connectedAccountId");
  const toolkit = (url.searchParams.get("toolkit") ?? "").toUpperCase();

  const user = await getCurrentUser();
  if (!user) {
    // User was logged in to initiate; if cookie expired during OAuth, just send to signin.
    return NextResponse.redirect(new URL("/signin?next=/settings/integrations", redirectBase));
  }

  if (status !== "success" || !connectedAccountId || !toolkit) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=callback_${status}`, redirectBase),
    );
  }

  const admin = createSupabaseAdmin();

  await admin.from("audit_log").insert({
    org_id: user.orgId,
    actor: user.id,
    action: "integration.connected",
    payload: { toolkit, connected_account_id: connectedAccountId },
  });

  // Re-point any real-time triggers this toolkit needs at the new connection.
  // Best-effort: a failure here shouldn't block the connect itself, but it
  // should be visible in audit_log rather than silently leaving George on
  // the slow backstop sync.
  for (const triggerName of TOOLKIT_TRIGGERS[toolkit] ?? []) {
    const result = await ensureTrigger(triggerName, connectedAccountId);
    await admin.from("audit_log").insert({
      org_id: user.orgId,
      actor: "system",
      action: result.ok ? "integration.trigger_armed" : "integration.trigger_failed",
      payload: result.ok
        ? { toolkit, trigger: triggerName, trigger_id: result.data.trigger_id }
        : { toolkit, trigger: triggerName, error: result.error },
    });
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?connected=${toolkit.toLowerCase()}`, redirectBase),
  );
}
