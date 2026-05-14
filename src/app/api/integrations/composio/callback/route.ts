import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Composio redirects here after the user finishes provider OAuth.
 * Query string carries `?status=success&connected_account_id=ca_...&toolkit=OUTLOOK`
 * (toolkit comes from the URL we built in connectToolkitAction).
 *
 * We persist the connection to our `integrations` table for fast UI status
 * lookups and then bounce the user back to /settings/integrations.
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
  const provider = toolkit === "OUTLOOK" ? "m365" : toolkit.toLowerCase();

  // Upsert into integrations so the UI can read it without a Composio round trip.
  await admin
    .from("integrations")
    .upsert(
      {
        org_id: user.orgId,
        provider,
        status: "connected",
        external_id: connectedAccountId,
        last_synced_at: new Date().toISOString(),
        metadata: { toolkit, connected_via: "composio" },
      },
      { onConflict: "org_id,provider" },
    );

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
