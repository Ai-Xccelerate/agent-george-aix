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
  // 1. Local org row, keyed by clerk_org_id. Upsert-then-read is race-safe:
  //    concurrent getCurrentUser calls (layout + page render in parallel) won't
  //    collide on the unique constraint. ignoreDuplicates keeps the existing
  //    name if the row is already there.
  const name = input.orgSlug || input.clerkOrgId;
  const upsertedOrg = await admin
    .from("orgs")
    .upsert({ clerk_org_id: input.clerkOrgId, name }, { onConflict: "clerk_org_id", ignoreDuplicates: true });
  if (upsertedOrg.error) {
    throw new Error(`jit-mirror: could not upsert org — ${upsertedOrg.error.message}`);
  }
  const org = await admin
    .from("orgs")
    .select("id, name")
    .eq("clerk_org_id", input.clerkOrgId)
    .single();
  if (org.error || !org.data) {
    throw new Error(`jit-mirror: could not read org — ${org.error?.message}`);
  }
  const orgId = org.data.id;
  const orgName = org.data.name;

  // 2. Membership row, keyed by (org_id, clerk user_id). Same race-safe upsert;
  //    ignoreDuplicates preserves an existing member's role.
  const upsertedMember = await admin.from("org_members").upsert(
    {
      org_id: orgId,
      user_id: input.clerkUserId,
      role: input.orgRole,
      email: input.email,
      full_name: input.fullName,
    },
    { onConflict: "org_id,user_id", ignoreDuplicates: true },
  );
  if (upsertedMember.error) {
    throw new Error(`jit-mirror: could not upsert membership — ${upsertedMember.error.message}`);
  }

  const member = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", input.clerkUserId)
    .single();

  return { orgId, orgName, role: member.data?.role ?? input.orgRole };
}

/** Map a Clerk org role (e.g. "org:admin") to a valid George org_members role. */
export function normalizeClerkRole(raw: string | null | undefined): string {
  const r = (raw ?? "").replace(/^org:/, "").toLowerCase();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "member") return "csm"; // George has no "member" role; CSM is the default seat
  return "viewer";
}
