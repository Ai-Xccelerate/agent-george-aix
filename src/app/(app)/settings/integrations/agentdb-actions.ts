"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { enableAgentDbForOrg } from "@/lib/agent/agentdb";

/**
 * Switch AgentDB on for the signed-in user's organisation.
 *
 * This has to be a user-initiated action, not a background job: AgentDB
 * re-checks entitlement against AIX Core using the caller's Clerk JWT, and the
 * shared internal key alone is not enough. That is why there is a button here
 * at all — see the two-auth-phases note in lib/agent/agentdb.ts.
 *
 * Errors come back as a query param rather than a thrown 500, because every
 * failure here is something an admin can act on (wrong org, not entitled,
 * AgentDB down) and needs to be readable on the page.
 */
export async function enableAgentDbAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // Enabling a data source for the whole org is an admin decision. The page
  // hides the control for non-admins; the action enforces it independently.
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const { orgId: clerkOrgId, getToken } = await auth();
  if (!clerkOrgId) redirect("/settings/integrations?agentdb=no_org");

  // The JWT must belong to the same org, or AgentDB answers org_mismatch.
  const token = await getToken();
  if (!token) redirect("/settings/integrations?agentdb=no_token");

  const result = await enableAgentDbForOrg({ clerkOrgId, clerkJwt: token });

  let outcome: string;
  if (!result.ok) {
    outcome = `failed&detail=${encodeURIComponent(result.error)}`;
  } else if (!result.hasAccess) {
    // A 200 with has_access:false is AgentDB's documented "Core says this org
    // isn't entitled" answer. Nothing was provisioned, and it is not a bug.
    outcome = "not_entitled";
  } else {
    outcome = "enabled";
  }

  revalidatePath("/settings/integrations");
  redirect(`/settings/integrations?agentdb=${outcome}`);
}
