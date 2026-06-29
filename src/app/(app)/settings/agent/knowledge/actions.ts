"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { publishProposal } from "@/lib/knowledge/publish";
import { AGENT_SLUG } from "@/lib/agent/agent-settings";

export type ActionResult = { error?: string; info?: string };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." as const };
  if (user.role !== "owner" && user.role !== "admin")
    return { error: "Admins only." as const };
  return { user };
}

/**
 * Approve (publish) or reject a staged knowledge proposal. One action so the
 * review card can be a single form with two submit buttons (`decision`).
 */
export async function reviewProposalAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const id = String(formData.get("proposal_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id) return { error: "Missing proposal." };
  const note = String(formData.get("note") ?? "").trim() || null;

  const admin = createSupabaseAdmin();
  const owns = await admin
    .from("knowledge_proposals")
    .select("id")
    .eq("id", id)
    .eq("org_id", user.orgId)
    .maybeSingle();
  if (!owns.data) return { error: "Proposal not found in this org." };

  if (decision === "approve") {
    const result = await publishProposal(admin, id, user.id, note);
    if (!result.ok) return { error: result.error };
    revalidatePath("/settings/agent/knowledge");
    return { info: `Published — ${result.chunks} chunk(s) embedded into retrieval.` };
  }

  if (decision === "reject") {
    const { error } = await admin
      .from("knowledge_proposals")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: note,
      })
      .eq("id", id)
      .eq("org_id", user.orgId)
      .eq("status", "pending");
    if (error) return { error: error.message };
    revalidatePath("/settings/agent/knowledge");
    return { info: "Proposal rejected." };
  }

  return { error: "Unknown decision." };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Save the configurable list of knowledge reviewers (e.g. Nawaz, John). */
export async function updateReviewersAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const raw = String(formData.get("reviewers") ?? "");
  const emails = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length) return { error: `Not a valid email: ${invalid[0]}` };
  const unique = Array.from(new Set(emails));

  const admin = createSupabaseAdmin();
  const { error } = await admin.from("agent_settings").upsert(
    {
      org_id: user.orgId,
      agent_slug: AGENT_SLUG,
      knowledge_reviewers: unique,
      updated_by: user.id,
    },
    { onConflict: "org_id,agent_slug" },
  );
  if (error) return { error: error.message };

  revalidatePath("/settings/agent/knowledge");
  return { info: unique.length ? `Reviewers saved (${unique.length}).` : "Reviewers cleared." };
}
