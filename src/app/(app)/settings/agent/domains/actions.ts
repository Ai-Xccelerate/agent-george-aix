"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { type ActionResult, requireApprover } from "@/lib/actions";

export type { ActionResult } from "@/lib/actions";

function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // Basic shape check — at least one dot, no spaces, no @ (a domain, not an address).
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) return null;
  return d;
}

/** Any org member can propose a domain — lands as `pending`. */
export async function proposeDomainAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireApprover();
  // Proposing is intentionally open to any member per the RLS policy, but
  // this settings page is approver-only real estate, so requiring the same
  // role here keeps the UI and the write path consistent.
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  if (!domain) return { error: "Enter a valid domain, e.g. acmecorp.com." };
  if (domain === "getonyx.ai" || domain === "aixccelerate.com") {
    return { error: "That domain is already internal — no approval needed." };
  }
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const admin = createSupabaseAdmin();
  const { error } = await admin.from("domain_allowlist").insert({
    org_id: user.orgId,
    domain,
    reason,
    requested_by: user.id,
  });
  if (error) {
    return {
      error: error.message.includes("domain_allowlist_org_domain_idx")
        ? `${domain} is already on the list.`
        : error.message,
    };
  }

  revalidatePath("/settings/agent/domains");
  return { info: `${domain} added — awaiting approval.` };
}

/** Approve or reject a pending domain. Owner/admin/CSM only. */
export async function decideDomainAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await requireApprover();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const id = String(formData.get("domain_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id) return { error: "Missing domain." };
  if (decision !== "approved" && decision !== "rejected") {
    return { error: "Unknown decision." };
  }
  const note = String(formData.get("note") ?? "").trim() || null;

  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("domain_allowlist")
    .update({
      status: decision,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq("id", id)
    .eq("org_id", user.orgId)
    .eq("status", "pending")
    .select("domain")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "That domain isn't pending anymore." };

  revalidatePath("/settings/agent/domains");
  return {
    info:
      decision === "approved"
        ? `${data.domain} approved — George can now email that domain.`
        : `${data.domain} rejected.`,
  };
}

/** Revoke a previously approved domain. Owner/admin/CSM only. */
export async function revokeDomainAction(formData: FormData) {
  const auth = await requireApprover();
  if ("error" in auth) return;
  const { user } = auth;
  const id = String(formData.get("domain_id") ?? "");
  if (!id) return;

  const admin = createSupabaseAdmin();
  await admin
    .from("domain_allowlist")
    .update({
      status: "rejected",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_note: "Revoked after approval.",
    })
    .eq("id", id)
    .eq("org_id", user.orgId)
    .eq("status", "approved");

  revalidatePath("/settings/agent/domains");
}

/**
 * Put a revoked domain back on the allowlist.
 *
 * WHY THIS HAS TO EXIST
 * Revoking wrote `rejected`, and `decideDomainAction` only moves rows out of
 * `pending` — so there was no transition back. Revoke was a one-way door, and
 * the page did not even list rejected rows, so the domain vanished.
 *
 * That is worse than a missing feature. A guard people cannot reverse is a
 * guard people stop using: faced with "revoke and possibly never get it back",
 * the rational move is to leave the domain approved. The control that is
 * hardest to undo is the one that quietly stops being touched, and an allowlist
 * nobody prunes is an allowlist that only grows.
 *
 * Re-approving is deliberately the same privilege as approving — approver only,
 * audited the same way, and the note records that it came back rather than
 * pretending it was never gone.
 */
export async function reapproveDomainAction(formData: FormData) {
  const auth = await requireApprover();
  if ("error" in auth) return;
  const { user } = auth;
  const id = String(formData.get("domain_id") ?? "");
  if (!id) return;

  const admin = createSupabaseAdmin();
  await admin
    .from("domain_allowlist")
    .update({
      status: "approved",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_note: "Re-approved after revocation.",
    })
    .eq("id", id)
    .eq("org_id", user.orgId)
    // Only from rejected. A pending row still goes through the normal decision,
    // so this cannot be used to skip that.
    .eq("status", "rejected");

  revalidatePath("/settings/agent/domains");
}
