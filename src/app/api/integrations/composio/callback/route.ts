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
  const status = url.searchParams.get("status") ?? "unknown";
  const connectedAccountId =
    url.searchParams.get("connected_account_id") ??
    url.searchParams.get("connectedAccountId");
  const toolkit = (url.searchParams.get("toolkit") ?? "").toUpperCase();

  const user = await getCurrentUser();
  if (!user) {
    // User was logged in to initiate; if cookie expired during OAuth, just send to signin.
    return NextResponse.redirect(new URL("/signin?next=/settings/integrations", url));
  }

  if (status !== "success" || !connectedAccountId || !toolkit) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=callback_${status}`, url),
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
    new URL(`/settings/integrations?connected=${toolkit.toLowerCase()}`, url),
  );
}
