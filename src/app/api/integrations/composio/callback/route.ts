import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

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

  return NextResponse.redirect(
    new URL(`/settings/integrations?connected=${toolkit.toLowerCase()}`, redirectBase),
  );
}
