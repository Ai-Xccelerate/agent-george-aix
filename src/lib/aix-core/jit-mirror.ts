/**
 * JIT tenant mirroring — create local org + membership rows on the first authed
 * request, keyed by Clerk identifiers. Per the playbook, agent apps do NOT wire
 * Clerk webhooks (Core owns the only subscription); we mirror lazily instead.
 *
 * Runs on the service-role admin client (bypasses RLS) — the security boundary
 * is the Clerk session + Core /access gate, not Postgres RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MirrorInput = {
  clerkUserId: string;
  clerkOrgId: string;
  orgRole: string; // already normalized to a valid George role
  orgSlug?: string | null;
  email: string | null;
  fullName: string | null;
};

export type MirroredTenant = { orgId: string; orgName: string; role: string };

export async function ensureTenantRows(
  admin: SupabaseClient,
  input: MirrorInput,
): Promise<MirroredTenant> {
  // 1. Local org row, keyed by clerk_org_id. Create with a placeholder name if
  //    absent (backfilled later from Core's canonical org name).
  const existingOrg = await admin
    .from("orgs")
    .select("id, name")
    .eq("clerk_org_id", input.clerkOrgId)
    .maybeSingle();

  let orgId: string;
  let orgName: string;
  if (existingOrg.data) {
    orgId = existingOrg.data.id;
    orgName = existingOrg.data.name;
  } else {
    const name = input.orgSlug || input.clerkOrgId;
    const created = await admin
      .from("orgs")
      .insert({ clerk_org_id: input.clerkOrgId, name })
      .select("id, name")
      .single();
    if (created.error || !created.data) {
      throw new Error(`jit-mirror: could not create org — ${created.error?.message}`);
    }
    orgId = created.data.id;
    orgName = created.data.name;
  }

  // 2. Membership row, keyed by (org_id, clerk user_id). Idempotent.
  const existingMember = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", input.clerkUserId)
    .maybeSingle();

  if (existingMember.data) {
    return { orgId, orgName, role: existingMember.data.role };
  }

  const inserted = await admin.from("org_members").insert({
    org_id: orgId,
    user_id: input.clerkUserId,
    role: input.orgRole,
    email: input.email,
    full_name: input.fullName,
  });
  if (inserted.error) {
    throw new Error(`jit-mirror: could not create membership — ${inserted.error.message}`);
  }

  return { orgId, orgName, role: input.orgRole };
}

/** Map a Clerk org role (e.g. "org:admin") to a valid George org_members role. */
export function normalizeClerkRole(raw: string | null | undefined): string {
  const r = (raw ?? "").replace(/^org:/, "").toLowerCase();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "member") return "csm"; // George has no "member" role; CSM is the default seat
  return "viewer";
}
