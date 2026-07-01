"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function newChatAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

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
  if (error || !data) throw new Error(error?.message ?? "Could not start chat.");

  revalidatePath("/chat");
  redirect(`/chat/${data.id}`);
}

/**
 * Start (or reuse) a chat thread bound to a specific customer, for the account
 * hub's inline "Ask George about <partner>" launcher. Returns the session id so
 * the client can mount the embedded chat inline — no redirect. The session's
 * `customer_id` makes George account-aware (see /api/chat → buildGeorgeSystemPrompt).
 * Reuses the most recent still-empty account thread so repeated clicks don't
 * pile up blank sessions.
 */
export async function startAccountChatAction(customerId: string): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const admin = createSupabaseAdmin();

  const existing = await admin
    .from("agent_sessions")
    .select("id")
    .eq("org_id", user.orgId)
    .eq("customer_id", customerId)
    .eq("channel", "chat")
    .is("title", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id as string;

  const { data, error } = await admin
    .from("agent_sessions")
    .insert({
      org_id: user.orgId,
      user_id: user.id,
      channel: "chat",
      customer_id: customerId,
      title: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not start chat.");
  return data.id as string;
}

export async function deleteChatAction(formData: FormData) {
  const id = String(formData.get("session_id") ?? "");
  if (!id) return;
  const user = await getCurrentUser();
  if (!user) return;

  const admin = createSupabaseAdmin();
  // Org-scope only — don't filter by user_id. Inbound-event sessions have
  // user_id=null and any org member should be able to clean those up too.
  // agent_messages cascade on delete, so we don't need a separate cleanup.
  const { error } = await admin
    .from("agent_sessions")
    .delete()
    .eq("id", id)
    .eq("org_id", user.orgId);
  if (error) throw new Error(error.message);

  revalidatePath("/chat");
  redirect("/chat");
}

/**
 * Slash command: delete the current session AND immediately spin up a new
 * one, redirecting to it. Used by `/clear` in the chat input. Same
 * org-scope rule as deleteChatAction.
 */
/**
 * Lightweight customer lookup for the chat input's @-mention autocomplete.
 * Returns up to `limit` customers in this org matching `q` by name prefix
 * (case-insensitive). Empty `q` returns the most-recently-updated rows so
 * a bare `@` shows the top of the list.
 */
export async function searchCustomersAction(
  q: string,
  limit = 8,
): Promise<
  Array<{
    id: string;
    name: string;
    kind: "partner" | "end_customer";
    domain: string | null;
  }>
> {
  const user = await getCurrentUser();
  if (!user) return [];

  const admin = createSupabaseAdmin();
  let qb = admin
    .from("customers")
    .select("id, name, customer_kind, domain")
    .eq("org_id", user.orgId);

  const trimmed = q.trim();
  if (trimmed.length > 0) {
    // Match on prefix in name OR domain, case-insensitive.
    qb = qb.or(`name.ilike.${trimmed}%,domain.ilike.${trimmed}%`);
  }

  const { data, error } = await qb
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[searchCustomers] query failed", { error: error.message });
    return [];
  }

  return ((data ?? []) as Array<{
    id: string;
    name: string;
    customer_kind: "partner" | "end_customer";
    domain: string | null;
  }>).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.customer_kind,
    domain: r.domain,
  }));
}

export async function clearAndStartNewChatAction(sessionId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const admin = createSupabaseAdmin();
  if (sessionId) {
    const { error: delError } = await admin
      .from("agent_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("org_id", user.orgId);
    if (delError) {
      console.error("[chat] clearAndStartNew delete failed", { sessionId, error: delError.message });
    }
  }

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
  if (error || !data) throw new Error(error?.message ?? "Could not start chat.");

  revalidatePath("/chat");
  redirect(`/chat/${data.id}`);
}
