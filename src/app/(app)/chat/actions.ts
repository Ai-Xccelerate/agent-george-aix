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

  const { data } = await qb
    .order("updated_at", { ascending: false })
    .limit(limit);

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
    await admin
      .from("agent_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("org_id", user.orgId);
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
