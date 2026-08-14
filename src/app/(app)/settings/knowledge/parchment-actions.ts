"use server";

/**
 * Choose an org's Parchment workspace, or switch knowledge grounding off.
 *
 * There is no "connect" action any more: the internal agent path is
 * default-allow, so an org's default workspace exists the moment anything asks
 * for it. What remains is a preference — which workspace, and an escape hatch to
 * stop using Parchment for this org at all.
 *
 * Admin-only, and the org comes from the session rather than the form, so a user
 * cannot repoint somebody else's organisation by editing a hidden field.
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { selectWorkspace, setParchmentEnabled } from "@/lib/parchment/connection";

export type ActionState = { error?: string; info?: string };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." as const, user: null };
  if (user.role !== "owner" && user.role !== "admin") {
    return { error: "Only owners and admins can change knowledge settings." as const, user: null };
  }
  return { error: null, user };
}

export async function selectWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { error: authError, user } = await requireAdmin();
  if (authError || !user) return { error: authError ?? "Not signed in." };

  const raw = String(formData.get("workspace_id") ?? "").trim();
  // Empty string is the "use the organisation's default" option.
  const workspaceId = raw === "" ? null : raw;

  const res = await selectWorkspace(
    createSupabaseAdmin(),
    user.orgId,
    workspaceId,
    user.email ?? user.id,
  );
  if (!res.ok) return { error: res.error };

  revalidatePath("/settings/knowledge");
  return {
    info: workspaceId
      ? "Knowledge base updated. George will search that workspace."
      : "Using the organisation's default workspace.",
  };
}

export async function setParchmentEnabledAction(enabled: boolean): Promise<ActionState> {
  const { error: authError, user } = await requireAdmin();
  if (authError || !user) return { error: authError ?? "Not signed in." };

  const res = await setParchmentEnabled(
    createSupabaseAdmin(),
    user.orgId,
    enabled,
    user.email ?? user.id,
  );
  if (!res.ok) return { error: res.error };

  revalidatePath("/settings/knowledge");
  return {
    info: enabled
      ? "George will search your organisation's knowledge base again."
      : "Knowledge grounding is off for this organisation. George will answer from its core playbooks and its own supplemental docs only.",
  };
}
