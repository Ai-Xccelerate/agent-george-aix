"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getComposio, composioOrgIdentity } from "@/lib/composio/client";
import { getCurrentUser } from "@/lib/supabase/current-user";

// Optional last-resort env fallback for the three toolkits we originally
// hardcoded. New toolkits added in the Composio dashboard pass their
// authConfigId directly via the form — no env plumbing required.
const AUTH_CONFIG_ENV: Record<string, string | undefined> = {
  OUTLOOK: process.env.COMPOSIO_AUTH_CONFIG_OUTLOOK,
  FIREFLIES: process.env.COMPOSIO_AUTH_CONFIG_FIREFLIES,
  ONEDRIVE: process.env.COMPOSIO_AUTH_CONFIG_ONEDRIVE,
};

/**
 * Initiates a Composio connection. The row submits the toolkit slug plus the
 * Composio auth-config id; we redirect to the provider's OAuth screen. After
 * auth Composio bounces back to /api/integrations/composio/callback.
 */
export async function connectToolkitAction(formData: FormData) {
  const toolkit = String(formData.get("toolkit") ?? "").toUpperCase();
  const authConfigFromForm = String(formData.get("auth_config_id") ?? "").trim();
  const authConfigId = authConfigFromForm || AUTH_CONFIG_ENV[toolkit];

  if (!authConfigId) {
    redirect(`/settings/integrations?error=missing_auth_config_${toolkit.toLowerCase()}`);
  }

  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const hdrs = await headers();
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${hdrs.get("x-forwarded-proto") ?? "http"}://${hdrs.get("host")}`;
  const callbackUrl = `${baseUrl}/api/integrations/composio/callback?toolkit=${encodeURIComponent(toolkit)}`;

  try {
    const composio = getComposio();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const link = await (composio.connectedAccounts as any).link(
      composioOrgIdentity(user.orgId),
      authConfigId,
      { callbackUrl },
    );

    const redirectUrl =
      link?.redirectUrl ?? link?.redirect_url ?? link?.authorizationUrl ?? null;

    if (!redirectUrl) {
      redirect(`/settings/integrations?error=no_redirect_url_${toolkit.toLowerCase()}`);
    }

    redirect(redirectUrl);
  } catch (err: unknown) {
    // `redirect()` throws a special error to short-circuit — let it through.
    if (err && typeof err === "object" && "digest" in err) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[composio connect] failed", { toolkit, message });
    redirect(`/settings/integrations?error=link_failed_${toolkit.toLowerCase()}`);
  }
}

/**
 * Tear down a Composio connected account for a toolkit. Used by the
 * "Disconnect" button on /settings/integrations.
 *
 * We prefer the explicit `account_id` from the form (set when we have it
 * from `listOrgConnections`), and fall back to a lookup by toolkit if the
 * id isn't passed.
 */
export async function disconnectToolkitAction(formData: FormData) {
  const toolkit = String(formData.get("toolkit") ?? "").toUpperCase();
  const accountIdFromForm = String(formData.get("account_id") ?? "").trim();

  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  try {
    const composio = getComposio();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = composio.connectedAccounts as any;

    let accountId = accountIdFromForm || null;
    if (!accountId) {
      // Resolve by listing — last-resort path for older summaries that
      // didn't have an id.
      const list = await accounts?.list?.({
        userIds: [composioOrgIdentity(user.orgId)],
      });
      const raw = (list?.items ?? list?.data ?? list ?? []) as Array<{
        toolkit?: { slug?: string };
        appName?: string;
        id?: string;
      }>;
      const match = raw.find(
        (r) => (r.toolkit?.slug ?? r.appName ?? "").toUpperCase() === toolkit,
      );
      accountId = match?.id ?? null;
    }

    if (!accountId) {
      console.warn("[composio disconnect] no account found", { toolkit });
      redirect(
        `/settings/integrations?error=already_disconnected_${toolkit.toLowerCase()}`,
      );
    }

    // SDK exposes either `.delete(id)` or `.disconnect(id)` depending on
    // version — try both shapes.
    if (typeof accounts.delete === "function") {
      await accounts.delete(accountId);
    } else if (typeof accounts.disconnect === "function") {
      await accounts.disconnect(accountId);
    } else {
      throw new Error(
        "Composio SDK does not expose a connectedAccounts.delete / .disconnect method.",
      );
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[composio disconnect] failed", { toolkit, message });
    redirect(
      `/settings/integrations?error=disconnect_failed_${toolkit.toLowerCase()}`,
    );
  }

  revalidatePath("/settings/integrations");
  redirect(`/settings/integrations?disconnected=${toolkit.toLowerCase()}`);
}
