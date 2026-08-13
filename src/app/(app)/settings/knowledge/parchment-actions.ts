"use server";

/**
 * Connect, re-check and disconnect an org's Parchment knowledge hub.
 *
 * Admin-only, and the org is taken from the session rather than the form — a
 * user must not be able to attach a knowledge hub to somebody else's
 * organisation by editing a hidden field.
 *
 * The API key arrives here and stops here: it is encrypted before storage and
 * never sent back to the browser.
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  disconnectParchment,
  recheckParchmentConnection,
  saveParchmentConnection,
} from "@/lib/parchment/connection";

export type ActionState = { error?: string; info?: string };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." as const, user: null };
  if (user.role !== "owner" && user.role !== "admin") {
    return { error: "Only owners and admins can change knowledge settings." as const, user: null };
  }
  return { error: null, user };
}

export async function connectParchmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { error: authError, user } = await requireAdmin();
  if (authError || !user) return { error: authError ?? "Not signed in." };

  const baseUrl = String(formData.get("base_url") ?? "");
  const apiKey = String(formData.get("api_key") ?? "");

  const res = await saveParchmentConnection(createSupabaseAdmin(), user.orgId, {
    baseUrl,
    apiKey,
    actor: user.email ?? user.id,
  });
  if (!res.ok) return { error: res.error };

  revalidatePath("/settings/knowledge");
  return {
    info:
      res.documents === 0
        ? "Connected. The workspace is empty, so searches will return nothing until documents are ingested there."
        : `Connected. ${res.documents ?? "?"} document${res.documents === 1 ? "" : "s"} available to George.`,
  };
}

export async function recheckParchmentAction(): Promise<ActionState> {
  const { error: authError, user } = await requireAdmin();
  if (authError || !user) return { error: authError ?? "Not signed in." };

  const res = await recheckParchmentConnection(createSupabaseAdmin(), user.orgId);
  revalidatePath("/settings/knowledge");
  return res.ok
    ? { info: `Connection is healthy. ${res.documents ?? "?"} document(s) visible.` }
    : { error: res.error };
}

export async function disconnectParchmentAction(): Promise<ActionState> {
  const { error: authError, user } = await requireAdmin();
  if (authError || !user) return { error: authError ?? "Not signed in." };

  const res = await disconnectParchment(createSupabaseAdmin(), user.orgId);
  if (!res.ok) return { error: res.error };

  revalidatePath("/settings/knowledge");
  return {
    info:
      "Disconnected. The stored key has been deleted and George is back to its own knowledge base.",
  };
}
