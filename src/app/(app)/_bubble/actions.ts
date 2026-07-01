"use server";

import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Pre-create an empty chat session row for the floating bubble.
 *
 * The bubble needs a `sessionId` before the user sends anything (so the
 * existing `ChatClient` component, which expects a non-null id, can be
 * rendered immediately on open). Title is null — the chat route will
 * fill it in on first turn just like for the main `/chat` flow.
 */
export async function createBubbleSessionAction(): Promise<{
  id: string;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("agent_sessions")
    .insert({
      org_id: user.orgId,
      user_id: user.id,
      channel: "chat",
      title: null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[bubble] session creation failed", { error: error?.message });
    return null;
  }
  return { id: data.id };
}

/**
 * Resolve a customer-page URL slug into the display fields the bubble
 * needs to render its "include this customer" context chip. Org-scoped
 * — returns null if the id doesn't belong to the caller's org so the
 * bubble silently degrades to context-less mode rather than leaking
 * cross-org data.
 */
export async function getCustomerForContextAction(
  id: string,
): Promise<{
  id: string;
  name: string;
  kind: "partner" | "end_customer";
  domain: string | null;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const admin = createSupabaseAdmin();
  const { data } = await admin
    .from("customers")
    .select("id, name, customer_kind, domain")
    .eq("id", id)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    kind: data.customer_kind,
    domain: data.domain,
  };
}
