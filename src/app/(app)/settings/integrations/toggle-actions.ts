"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { setEnabled, type ToggleableIntegration } from "@/lib/agent/integration-toggle";

/**
 * Turn one integration on or off for the signed-in user's organisation.
 *
 * Per-org by construction: the org comes from the session, never from the form,
 * so a crafted submission cannot flip another tenant's integration.
 *
 * Admin-only, enforced here rather than only in the UI. The page hides these
 * controls for non-admins, but a hidden button is not an access control.
 */
async function toggle(integration: ToggleableIntegration, enabled: boolean) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const res = await setEnabled(
    createSupabaseAdmin(),
    user.orgId,
    integration,
    enabled,
    user.email ?? user.id,
  );

  revalidatePath("/settings/integrations");
  if (!res.ok) {
    redirect(`/settings/integrations?toggle_error=${encodeURIComponent(res.error)}`);
  }
  redirect(
    `/settings/integrations?toggled=${integration}&state=${enabled ? "on" : "off"}`,
  );
}

export async function enableIntegrationAction(formData: FormData) {
  const integration = String(formData.get("integration") ?? "") as ToggleableIntegration;
  await toggle(integration, true);
}

export async function disableIntegrationAction(formData: FormData) {
  const integration = String(formData.get("integration") ?? "") as ToggleableIntegration;
  await toggle(integration, false);
}
